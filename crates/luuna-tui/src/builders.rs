//! The request builders both clients send one body through (formerly in packages/api-client):
//! registration rows and plan task graphs. They refuse, before anything is sent, only what no
//! runtime would accept; the runtime validates everything again. Property access follows the
//! original: a field the original read from a missing value is a `TypeError` here too.
use crate::failures::Failure;
use crate::js::{safe_integer, J};

/// V8's TypeError for calling `method` on `value`, which the expression `expr` produced.
pub fn not_callable(value: &J, expr: &str, method: &str) -> Failure {
    Failure::Type(match value {
        J::Undefined => format!("Cannot read properties of undefined (reading '{method}')"),
        J::Null => format!("Cannot read properties of null (reading '{method}')"),
        _ => format!("{expr}.{method} is not a function"),
    })
}

/// `expr.trim()` on a value that must be a string (anything else is V8's TypeError).
pub fn trim_expr(value: &J, expr: &str) -> Result<String, Failure> {
    match value {
        J::Str(s) => Ok(js_trim(s)),
        other => Err(not_callable(other, expr, "trim")),
    }
}

/// JavaScript's `String.prototype.trim` (Unicode whitespace and the BOM).
pub fn js_trim(text: &str) -> String {
    text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .to_string()
}

/// `registerProjectRequest(name, repositories, id)`.
pub fn register_project_request(
    name: &str,
    repositories: &[(String, String)],
    id: Option<&str>,
) -> Result<J, Failure> {
    let rows: Vec<(String, String)> = repositories
        .iter()
        .map(|(id, path)| (js_trim(id), js_trim(path)))
        .filter(|(id, path)| !id.is_empty() || !path.is_empty())
        .collect();
    if js_trim(name).is_empty() {
        return Err(Failure::error("A project needs a name."));
    }
    if rows.is_empty() {
        return Err(Failure::error(
            "Register at least one repository: an id and its absolute root path.",
        ));
    }
    if rows
        .iter()
        .any(|(id, path)| id.is_empty() || path.is_empty())
    {
        return Err(Failure::error(
            "Every repository row needs an id and an absolute root path.",
        ));
    }
    let mut seen = std::collections::HashSet::new();
    if !rows.iter().all(|(id, _)| seen.insert(id.clone())) {
        return Err(Failure::error(
            "Repository ids must be unique within a project.",
        ));
    }
    let mut request = J::obj();
    request.set("name", J::str(js_trim(name)));
    if let Some(id) = id.map(js_trim).filter(|id| !id.is_empty()) {
        request.set("id", J::str(id));
    }
    request.set(
        "repositories",
        J::Arr(
            rows.into_iter()
                .map(|(id, path)| crate::obj![("id", id), ("path", path)])
                .collect(),
        ),
    );
    Ok(request)
}

pub const TASK_ROLES: [&str; 3] = ["implementer", "repository_lead", "project_orchestrator"];

pub fn advisory_role(role: &str) -> bool {
    role == "repository_lead" || role == "project_orchestrator"
}

/// One task as a client collects it; string fields are `J` so a missing value fails like the original.
#[derive(Clone, Debug, Default)]
pub struct TaskDraft {
    pub id: Option<String>,
    pub repository_id: J,
    pub paths: Vec<String>,
    pub operations: Vec<String>,
    pub acceptance_criteria: Vec<String>,
    pub depends_on: Vec<String>,
    pub role: Option<String>,
    pub derived_from_task: Option<String>,
}

/// A dependency override as the CLI parsed it.
#[derive(Clone, Debug)]
pub struct Override {
    pub consumer: String,
    pub producer: String,
    pub action: String,
    pub justification: String,
}

/// The plan budgets in the order the request names them.
pub type Budgets = Vec<(&'static str, f64)>;

const BUDGET_LIMITS: [(&str, f64, f64); 4] = [
    ("max_workers", 1.0, 4.0),
    ("max_attempts", 1.0, 10.0),
    ("timeout_seconds", 1.0, 86_400.0),
    ("cost_usd_micros", 1.0, 1_000_000_000.0),
];

/// The runtime's refusal for an out-of-range budget, or None.
pub fn plan_budget_problem(budgets: &J) -> Option<String> {
    for (field, low, high) in BUDGET_LIMITS {
        let value = budgets.get(field);
        if value.is_undefined() {
            continue;
        }
        let ok = value
            .as_f64()
            .is_some_and(|v| safe_integer(v) && v >= low && v <= high);
        if !ok {
            return Some(format!(
                "budgets.{field} must be between {} and {}",
                crate::js::number_to_string(low),
                crate::js::number_to_string(high)
            ));
        }
    }
    None
}

/// `/^[\x21-\x7e]{1,128}$/`
pub fn valid_idempotency_key(key: &str) -> bool {
    (1..=128).contains(&key.len()) && key.bytes().all(|b| (0x21..=0x7e).contains(&b))
}

fn id_text(id: &Option<String>) -> String {
    id.clone().unwrap_or_else(|| "undefined".into())
}

/// `planRequestForTasks(drafts, budgets, { componentContext, dependencyOverrides, checks })`.
pub fn plan_request_for_tasks(
    drafts: &[TaskDraft],
    budgets: &Budgets,
    component_context: Option<J>,
    overrides: &[Override],
    checks: &[J],
) -> Result<J, Failure> {
    if drafts.is_empty() {
        return Err(Failure::error("A plan needs at least one task."));
    }
    let multiple = drafts.len() > 1;
    struct Task {
        id: Option<String>,
        object: J,
        role: String,
        depends: Vec<String>,
        derived: Option<String>,
        repository: String,
    }
    let mut tasks = Vec::new();
    for draft in drafts {
        let id = match &draft.id {
            Some(id) => js_trim(id),
            None => trim_expr(&draft.repository_id, "(draft.id ?? draft.repository_id)")?,
        };
        let repository = trim_expr(&draft.repository_id, "draft.repository_id")?;
        if repository.is_empty() {
            return Err(Failure::error("Every task names a registered repository."));
        }
        let paths: Vec<String> = draft
            .paths
            .iter()
            .map(|p| js_trim(p))
            .filter(|p| !p.is_empty())
            .collect();
        let depends: Vec<String> = draft
            .depends_on
            .iter()
            .map(|t| js_trim(t))
            .filter(|t| !t.is_empty())
            .collect();
        let criteria: Vec<String> = draft
            .acceptance_criteria
            .iter()
            .map(|l| js_trim(l))
            .filter(|l| !l.is_empty())
            .collect();
        let role = draft.role.clone().unwrap_or_else(|| "implementer".into());
        if !TASK_ROLES.contains(&role.as_str()) {
            return Err(Failure::error(format!("Task {id} has an unknown role {role}; a role is implementer, repository_lead or project_orchestrator.")));
        }
        if advisory_role(&role) && (draft.operations.len() != 1 || draft.operations[0] != "read") {
            return Err(Failure::error(format!("Task {id} has the advisory role {role}, which reads only: its operations must be exactly read.")));
        }
        let effective = if multiple {
            id.clone()
        } else {
            "implement".to_string()
        };
        let derived = draft.derived_from_task.as_deref().map(js_trim);
        if derived.as_deref() == Some(effective.as_str()) {
            return Err(Failure::error(format!(
                "Task {effective} cannot derive from itself."
            )));
        }
        let mut object = J::obj();
        if multiple {
            object.set("id", J::str(id.clone()));
        }
        object.set("repository_id", J::str(repository.clone()));
        object.set(
            "paths",
            J::Arr(if paths.is_empty() {
                vec![J::str("src")]
            } else {
                paths.into_iter().map(J::Str).collect()
            }),
        );
        object.set(
            "operations",
            J::Arr(draft.operations.iter().cloned().map(J::Str).collect()),
        );
        if !criteria.is_empty() {
            object.set(
                "acceptance_criteria",
                J::Arr(criteria.into_iter().map(J::Str).collect()),
            );
        }
        if !depends.is_empty() {
            object.set(
                "depends_on",
                J::Arr(depends.iter().cloned().map(J::Str).collect()),
            );
        }
        if role != "implementer" {
            object.set("role", J::str(role.clone()));
        }
        let derived = derived.filter(|d| !d.is_empty());
        if let Some(d) = &derived {
            object.set("derived_from_task", J::str(d.clone()));
        }
        tasks.push(Task {
            id: multiple.then_some(id),
            object,
            role,
            depends,
            derived,
            repository,
        });
    }
    let ids: Vec<String> = tasks
        .iter()
        .map(|t| t.id.clone().unwrap_or_else(|| "implement".into()))
        .collect();
    let unique =
        |list: &[String]| list.iter().collect::<std::collections::HashSet<_>>().len() == list.len();
    if !unique(
        &tasks
            .iter()
            .map(|t| t.repository.clone())
            .collect::<Vec<_>>(),
    ) {
        return Err(Failure::error("Each task of a plan targets a distinct repository; a dependent change inside one repository is one task."));
    }
    if !unique(&ids) {
        return Err(Failure::error("Task ids must be unique."));
    }
    for task in &tasks {
        for dependency in &task.depends {
            if Some(dependency) == task.id.as_ref() {
                return Err(Failure::error(format!(
                    "Task {} cannot depend on itself.",
                    id_text(&task.id)
                )));
            }
            if !ids.contains(dependency) {
                return Err(Failure::error(format!(
                    "Task {} depends on {dependency}, which is not a task of this plan.",
                    id_text(&task.id)
                )));
            }
        }
    }
    for task in &tasks {
        if let Some(derived) = &task.derived {
            if ids.contains(derived) {
                return Err(Failure::error(format!("Task {} derives from {derived}, a task of this same plan; it must name an advisory task of an earlier revision.", task.id.clone().unwrap_or_else(|| ids[0].clone()))));
            }
        }
    }
    let mut override_objects = Vec::new();
    let mut pairs = std::collections::HashSet::new();
    for o in overrides {
        let (consumer, producer, justification) = (
            js_trim(&o.consumer),
            js_trim(&o.producer),
            js_trim(&o.justification),
        );
        if o.action != "waive" && o.action != "add" {
            return Err(Failure::error(format!(
                "A dependency override's action is waive or add, not {}.",
                o.action
            )));
        }
        for name in [&consumer, &producer] {
            if !ids.contains(name) {
                return Err(Failure::error(format!(
                    "Dependency override names {}, which is not a task of this plan.",
                    if name.is_empty() {
                        "an empty task id"
                    } else {
                        name
                    }
                )));
            }
        }
        if consumer == producer {
            return Err(Failure::error(format!(
                "Dependency override names {consumer} as both consumer and producer."
            )));
        }
        let role_of = |name: &str| {
            tasks[ids.iter().position(|i| i == name).unwrap()]
                .role
                .clone()
        };
        if advisory_role(&role_of(&consumer)) || advisory_role(&role_of(&producer)) {
            return Err(Failure::error(format!("Dependency override {consumer}/{producer} names an advisory task; a dependency on an advisory task needs no override.")));
        }
        if justification.is_empty() {
            return Err(Failure::error(format!(
                "Dependency override {consumer}/{producer} needs a justification."
            )));
        }
        if !pairs.insert(format!("{consumer}\u{0}{producer}")) {
            return Err(Failure::error(format!(
                "Dependency override {consumer}/{producer} is repeated."
            )));
        }
        override_objects.push(crate::obj![
            ("consumer", consumer),
            ("producer", producer),
            ("action", o.action.clone()),
            ("justification", justification)
        ]);
    }
    let mut check_objects = Vec::new();
    for check in checks {
        let id = trim_expr(check.get("id"), "check.id")?;
        let executable = trim_expr(check.get("executable"), "check.executable")?;
        if id.is_empty() || executable.is_empty() {
            return Err(Failure::error(
                "Every testing-setup check needs an id and an executable.",
            ));
        }
        if check.get("required") == &J::Bool(false) {
            return Err(Failure::error(format!(
                "Check {id} is optional; a testing-setup plan proposes required checks only."
            )));
        }
        let timeout = check.get("timeout_seconds");
        if !timeout
            .as_f64()
            .is_some_and(|t| safe_integer(t) && t >= 1.0)
        {
            return Err(Failure::error(format!(
                "Check {id} needs a timeout in seconds of at least 1."
            )));
        }
        let list = |field: &str, item: &str| -> Result<Vec<J>, Failure> {
            let value = check.get(field);
            let items = if value.nullish() {
                &[][..]
            } else {
                value.as_arr().map(|v| v.as_slice()).ok_or_else(|| {
                    Failure::Type(format!("(check.{field} ?? []).map is not a function"))
                })?
            };
            Ok(items
                .iter()
                .map(|value| trim_expr(value, item))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .filter(|s| !s.is_empty())
                .map(J::Str)
                .collect())
        };
        let args = list("args", "arg")?;
        let capabilities = list("capabilities", "capability")?;
        let cwd = match check.get("cwd") {
            J::Undefined | J::Null => None,
            J::Str(text) => Some(js_trim(text)),
            _ => return Err(Failure::Type("check.cwd?.trim is not a function".into())),
        };
        let mut object = crate::obj![("id", id), ("executable", executable), ("args", args)];
        if let Some(cwd) = cwd.filter(|c| !c.is_empty() && c != ".") {
            object.set("cwd", J::str(cwd));
        }
        object
            .set("timeout_seconds", timeout.clone())
            .set("capabilities", J::Arr(capabilities))
            .set("required", J::Bool(true));
        check_objects.push(object);
    }
    let check_ids: Vec<String> = check_objects.iter().map(|c| c.get("id").js()).collect();
    if !unique(&check_ids) {
        return Err(Failure::error("Testing-setup check ids must be unique."));
    }
    if !check_objects.is_empty() && tasks.len() != 1 {
        return Err(Failure::error("A testing-setup plan is exactly one task on the repository whose baseline it establishes."));
    }
    let mut named = J::obj();
    let mut workers = None;
    for (field, value) in budgets {
        if *field == "max_workers" {
            workers = Some(*value);
        } else {
            named.set(field, J::Num(*value));
        }
    }
    if let Some(w) = workers.filter(|w| *w != 1.0) {
        named.set("max_workers", J::Num(w));
    }
    if let Some(w) = named.get("max_workers").as_f64() {
        if w > tasks.len() as f64 {
            return Err(Failure::error(format!(
                "budgets.max_workers must be between 1 and {} for {} task(s).",
                tasks.len(),
                tasks.len()
            )));
        }
    }
    if let Some(problem) = plan_budget_problem(&named) {
        return Err(Failure::error(problem));
    }
    let mut request = J::obj();
    if tasks.len() == 1 {
        request.set("task", tasks.remove(0).object);
    } else {
        request.set(
            "tasks",
            J::Arr(tasks.into_iter().map(|t| t.object).collect()),
        );
    }
    if !override_objects.is_empty() {
        request.set("dependency_overrides", J::Arr(override_objects));
    }
    if named.as_obj().is_some_and(|o| !o.is_empty()) {
        request.set("budgets", named);
    }
    if let Some(context) = component_context {
        if !context.get("memory_ids").items().is_empty() || context.get("prompt").truthy() {
            request.set("component_context", context);
        }
    }
    if !check_objects.is_empty() {
        request.set("checks", J::Arr(check_objects));
    }
    Ok(request)
}
