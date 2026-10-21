//! Explicit component activation, private memory and versioned prompt resources.
use crate::{internal, not_found, ApiError, AppState};
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use luuna_domain::{
    hash_value, valid_project_id, ApprovedPrompt, ComponentContext, MemoryReference,
    PromptReference,
};
use luuna_storage::MemoryBinding;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path as FsPath, PathBuf};

pub(crate) fn conflict(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::CONFLICT, message.into())
}
fn invalid(message: impl Into<String>) -> ApiError {
    ApiError(StatusCode::UNPROCESSABLE_ENTITY, message.into())
}
fn available(state: &AppState) -> Result<&luuna_components::Components, ApiError> {
    state.components.as_deref().ok_or_else(|| ApiError(StatusCode::SERVICE_UNAVAILABLE,
        "Pinned component toolchain unavailable; run npm run components:setup and restart the runtime".into()))
}
fn project(state: &AppState, id: &str) -> Result<(), ApiError> {
    if !valid_project_id(id) {
        return Err(not_found());
    }
    state
        .store
        .lock()
        .map_err(internal)?
        .get_project(id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    Ok(())
}
pub(crate) fn workspace(state: &AppState, id: &str) -> Result<PathBuf, ApiError> {
    project(state, id)?;
    Ok(state
        .config
        .data_dir
        .join("components")
        .join("projects")
        .join(id))
}
pub(crate) fn enabled(state: &AppState, id: &str) -> Result<bool, ApiError> {
    project(state, id)?;
    match state
        .store
        .lock()
        .map_err(internal)?
        .component_state(id)
        .map_err(internal)?
        .as_deref()
    {
        Some("enabled") => Ok(true),
        Some("initializing") => Err(conflict(
            "Component activation is incomplete; retry activation before changing this project",
        )),
        _ => Ok(false),
    }
}
fn require_enabled(state: &AppState, id: &str) -> Result<(), ApiError> {
    if !enabled(state, id)? {
        return Err(conflict(
            "Enable project components before using memory or prompts",
        ));
    }
    available(state)?;
    Ok(())
}
fn private_directory(path: &FsPath, anchor: &FsPath) -> Result<(), ApiError> {
    let relative = path
        .strip_prefix(anchor)
        .map_err(|_| invalid("Invalid component workspace"))?;
    for ancestor in anchor.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        if let Ok(metadata) = std::fs::symlink_metadata(ancestor) {
            let link = metadata.file_type().is_symlink();
            #[cfg(windows)]
            let link = {
                use std::os::windows::fs::MetadataExt;
                link || metadata.file_attributes() & 0x400 != 0
            };
            if link || !metadata.is_dir() {
                return Err(conflict(
                    "Component data directory contains a link or non-directory",
                ));
            }
        }
    }
    let mut current = anchor.to_owned();
    for part in relative.components() {
        current.push(part);
        if let Ok(metadata) = std::fs::symlink_metadata(&current) {
            let link = metadata.file_type().is_symlink();
            #[cfg(windows)]
            let link = {
                use std::os::windows::fs::MetadataExt;
                link || metadata.file_attributes() & 0x400 != 0
            };
            if link || !metadata.is_dir() {
                return Err(conflict(
                    "Component workspace contains a link or non-directory",
                ));
            }
        }
    }
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(path)
        .map_err(|_| invalid("Cannot create private component workspace"))?;
    Ok(())
}
async fn call(
    state: &AppState,
    component: &str,
    directory: &FsPath,
    args: Vec<String>,
) -> Result<Value, ApiError> {
    available(state)?.call(component,directory,&args).await.map_err(|_| ApiError(StatusCode::SERVICE_UNAVAILABLE,
        format!("{component} refused or unavailable; verify the pinned toolchain and managed store")))
}
pub async fn status(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let path = workspace(&state, &id)?;
    let phase = state
        .store
        .lock()
        .map_err(internal)?
        .component_state(&id)
        .map_err(internal)?;
    let reason = if state.components.is_none() {
        Some("Pinned component toolchain unavailable; run npm run components:setup and restart")
    } else if phase.as_deref() == Some("initializing") {
        Some("Activation is incomplete; retry to reconcile it")
    } else {
        None
    };
    Ok(Json(
        json!({"enabled":phase.as_deref()==Some("enabled"),"workspace_path":path,"reason":reason}),
    ))
}
pub async fn enable(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    let directory = workspace(&state, &id)?;
    let _guard = state.component_locks.lock().await;
    available(&state)?;
    state
        .store
        .lock()
        .map_err(internal)?
        .begin_component_enable(&id)
        .map_err(internal)?;
    private_directory(&directory, &state.config.data_dir)?;
    for (component, marker) in [
        ("missions", ".seeds/config.yaml"),
        ("atlas", ".mulch/mulch.config.yaml"),
        ("beacon", ".canopy/config.yaml"),
    ] {
        if !directory.join(marker).exists() {
            call(&state, component, &directory, vec!["init".into()]).await?;
        }
    }
    crate::missions::migrate_project(&state, &id).await?;
    state
        .store
        .lock()
        .map_err(internal)?
        .finish_component_enable(&id)
        .map_err(internal)?;
    drop(_guard);
    status(State(state), Path(id)).await
}

#[derive(Deserialize)]
pub struct MemoryQuery {
    #[serde(default)]
    pub include_user: bool,
    pub q: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreateMemory {
    pub idempotency_key: String,
    pub scope: String,
    pub content: String,
    pub provenance: String,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct MemoryRecord {
    pub id: String,
    pub scope: String,
    pub content: String,
    pub provenance: String,
    pub hash: String,
    pub created_at: String,
}
fn memory_workspace(state: &AppState, binding: &MemoryBinding) -> Result<PathBuf, ApiError> {
    if binding.scope == "user" {
        Ok(state.config.data_dir.join("components").join("user"))
    } else {
        workspace(state, &binding.project_id)
    }
}
async fn atlas_records(state: &AppState, directory: &FsPath) -> Result<Vec<Value>, ApiError> {
    let result = call(
        state,
        "atlas",
        directory,
        vec!["search".into(), "--type".into(), "convention".into()],
    )
    .await?;
    let domains = result["domains"]
        .as_array()
        .ok_or_else(|| invalid("Atlas returned an incompatible search contract"))?;
    let mut records = Vec::new();
    for domain in domains {
        for record in domain["matches"]
            .as_array()
            .ok_or_else(|| invalid("Atlas returned incompatible records"))?
        {
            records.push(json!({"domain":domain["domain"],"record":record}));
        }
    }
    Ok(records)
}
async fn resolved_memory(
    state: &AppState,
    binding: &MemoryBinding,
) -> Result<MemoryRecord, ApiError> {
    let directory = memory_workspace(state, binding)?;
    let rows = atlas_records(state, &directory).await?;
    memory_from_rows(binding, &rows)
}
fn memory_from_rows(binding: &MemoryBinding, rows: &[Value]) -> Result<MemoryRecord, ApiError> {
    let record = rows
        .iter()
        .find(|row| {
            row["record"]["id"].as_str() == Some(&binding.source_id)
                && row["domain"].as_str() == Some(&binding.domain)
        })
        .ok_or_else(|| {
            conflict("Atlas memory was removed or moved externally; refresh before continuing")
        })?;
    let raw = &record["record"];
    let envelope: Value = serde_json::from_str(
        raw["content"]
            .as_str()
            .ok_or_else(|| conflict("Atlas memory schema changed"))?,
    )
    .map_err(|_| conflict("Atlas memory schema changed externally"))?;
    if envelope["id"].as_str() != Some(&binding.id)
        || envelope["scope"].as_str() != Some(&binding.scope)
    {
        return Err(conflict(
            "Atlas memory identity or scope changed externally",
        ));
    }
    Ok(MemoryRecord {
        id: binding.id.clone(),
        scope: binding.scope.clone(),
        content: envelope["content"]
            .as_str()
            .ok_or_else(|| invalid("Memory content is invalid"))?
            .into(),
        provenance: envelope["provenance"]
            .as_str()
            .ok_or_else(|| invalid("Memory provenance is invalid"))?
            .into(),
        hash: hash_value(raw).map_err(internal)?,
        created_at: binding.created_at.clone(),
    })
}
async fn memory_records(
    state: &AppState,
    project_id: &str,
    include_user: bool,
) -> Result<Vec<MemoryRecord>, ApiError> {
    let bindings = state
        .store
        .lock()
        .map_err(internal)?
        .memory_bindings(project_id, include_user)
        .map_err(internal)?;
    let mut records = Vec::new();
    let mut snapshots = std::collections::BTreeMap::new();
    for binding in bindings {
        let directory = memory_workspace(state, &binding)?;
        if !snapshots.contains_key(&directory) {
            snapshots.insert(directory.clone(), atlas_records(state, &directory).await?);
        }
        records.push(memory_from_rows(&binding, &snapshots[&directory])?);
    }
    Ok(records)
}
pub async fn list_memory(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Query(query): Query<MemoryQuery>,
) -> Result<Json<Vec<MemoryRecord>>, ApiError> {
    require_enabled(&state, &id)?;
    let _guard = state.component_locks.lock().await;
    let mut records = memory_records(&state, &id, query.include_user).await?;
    if let Some(query) = query.q {
        if query.len() > 500 {
            return Err(invalid("Memory queries are bounded to 500 bytes"));
        }
        let needle = query.to_lowercase();
        records.retain(|record| {
            record.content.to_lowercase().contains(&needle)
                || record.provenance.to_lowercase().contains(&needle)
        });
    }
    Ok(Json(records))
}
pub async fn create_memory(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<CreateMemory>,
) -> Result<Json<MemoryRecord>, ApiError> {
    require_enabled(&state, &id)?;
    if !matches!(request.scope.as_str(), "project" | "process" | "user")
        || request.content.trim().is_empty()
        || request.content.len() > 16_000
        || request.provenance.trim().is_empty()
        || request.provenance.len() > 1000
    {
        return Err(invalid(
            "Memory requires a valid scope, bounded content and explicit provenance",
        ));
    }
    let _guard = state.component_locks.lock().await;
    let request_value =
        json!({"scope":request.scope,"content":request.content,"provenance":request.provenance});
    let operation = state
        .store
        .lock()
        .map_err(internal)?
        .begin_component_operation(
            &id,
            &request.idempotency_key,
            "memory.create",
            &request_value,
            &format!("mem-{}", uuid::Uuid::new_v4()),
        )
        .map_err(|_| conflict("Memory idempotency key conflicts with a previous request"))?;
    if let Some(response) = operation.response {
        return Ok(Json(serde_json::from_value(response).map_err(internal)?));
    }
    let directory = if request.scope == "user" {
        state.config.data_dir.join("components/user")
    } else {
        workspace(&state, &id)?
    };
    private_directory(&directory, &state.config.data_dir)?;
    if !directory.join(".mulch/mulch.config.yaml").exists() {
        call(&state, "atlas", &directory, vec!["init".into()]).await?;
    }
    let domain = format!("luuna-{}", request.scope);
    let payload = json!({"id":operation.record_id,"scope":request.scope,"content":request.content,"provenance":request.provenance});
    let rows = atlas_records(&state, &directory).await?;
    let matching: Vec<_> = rows
        .iter()
        .filter(|row| {
            row["record"]["content"]
                .as_str()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
                .is_some_and(|value| value["id"] == operation.record_id)
        })
        .collect();
    if matching.len() > 1 {
        return Err(conflict(
            "Duplicate Atlas delivery identities require source reconciliation",
        ));
    }
    let raw = if let Some(found) = matching.first() {
        if found["domain"].as_str() != Some(&domain)
            || found["record"]["content"].as_str() != Some(&payload.to_string())
        {
            return Err(conflict(
                "Uncertain memory write differs from the original request",
            ));
        }
        found["record"].clone()
    } else {
        if operation.attempted {
            return Err(conflict("Uncertain Atlas write cannot be reconciled by its identity; inspect the managed source before retrying"));
        }
        state
            .store
            .lock()
            .map_err(internal)?
            .mark_component_operation_attempted(&id, &request.idempotency_key)
            .map_err(internal)?;
        let response = call(
            &state,
            "atlas",
            &directory,
            vec![
                "record".into(),
                domain.clone(),
                payload.to_string(),
                "--type".into(),
                "convention".into(),
                "--tags".into(),
                operation.record_id.clone(),
            ],
        )
        .await?;
        response["record"].clone()
    };
    let source_id = raw["id"]
        .as_str()
        .ok_or_else(|| invalid("Atlas did not identify its created record"))?;
    let created = chrono::Utc::now().to_rfc3339();
    let binding = MemoryBinding {
        id: operation.record_id,
        project_id: id.clone(),
        scope: request.scope,
        source_id: source_id.into(),
        domain,
        created_at: created,
        deleted: false,
    };
    state
        .store
        .lock()
        .map_err(internal)?
        .record_memory_binding(&binding)
        .map_err(internal)?;
    let result = resolved_memory(&state, &binding).await?;
    state
        .store
        .lock()
        .map_err(internal)?
        .complete_component_operation(
            &id,
            &request.idempotency_key,
            &serde_json::to_value(&result).map_err(internal)?,
        )
        .map_err(internal)?;
    Ok(Json(result))
}
#[derive(Deserialize)]
pub struct DeleteMemoryQuery {
    pub expected_hash: String,
}
pub async fn delete_memory(
    State(state): State<AppState>,
    Path((project_id, id)): Path<(String, String)>,
    Query(query): Query<DeleteMemoryQuery>,
) -> Result<Json<Value>, ApiError> {
    require_enabled(&state, &project_id)?;
    let _guard = state.component_locks.lock().await;
    let binding = state
        .store
        .lock()
        .map_err(internal)?
        .memory_binding(&project_id, &id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    if !query.expected_hash.starts_with("sha256:")
        || query.expected_hash.len() != 71
        || !query.expected_hash[7..]
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit())
    {
        return Err(invalid("A valid displayed memory hash is required"));
    }
    let key = format!("memory-delete:{id}:{}", query.expected_hash);
    let operation = state
        .store
        .lock()
        .map_err(internal)?
        .begin_component_operation(
            &project_id,
            &key,
            "memory.delete",
            &json!({"id":id,"expected_hash":query.expected_hash}),
            &id,
        )
        .map_err(internal)?;
    if let Some(response) = operation.response {
        return Ok(Json(response));
    }
    let directory = memory_workspace(&state, &binding)?;
    let rows = atlas_records(&state, &directory).await?;
    let present = rows.iter().any(|row| {
        row["record"]["id"].as_str() == Some(&binding.source_id)
            && row["domain"].as_str() == Some(&binding.domain)
    });
    if present {
        let current = resolved_memory(&state, &binding).await?;
        if current.hash != query.expected_hash {
            return Err(conflict(
                "Memory changed since it was displayed; refresh before deleting",
            ));
        }
        state
            .store
            .lock()
            .map_err(internal)?
            .mark_component_operation_attempted(&project_id, &key)
            .map_err(internal)?;
        call(
            &state,
            "atlas",
            &directory,
            vec!["delete".into(), binding.domain, binding.source_id],
        )
        .await?;
    }
    // An absent bound source is already deleted, including an acknowledged CLI
    // delete whose response or local tombstone was lost during a restart.
    state
        .store
        .lock()
        .map_err(internal)?
        .delete_memory_binding(&id)
        .map_err(internal)?;
    let result = json!({"deleted":true,"id":id});
    state
        .store
        .lock()
        .map_err(internal)?
        .complete_component_operation(&project_id, &key, &result)
        .map_err(internal)?;
    Ok(Json(result))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CreatePrompt {
    pub idempotency_key: String,
    pub name: String,
    pub body: String,
    #[serde(default)]
    pub expected_version: Option<u64>,
}
#[derive(Deserialize)]
pub struct PromptQuery {
    pub version: Option<u64>,
}
#[derive(Serialize, Deserialize, Clone)]
pub struct RenderedPrompt {
    pub name: String,
    pub version: u64,
    pub hash: String,
    pub body: String,
}
fn valid_prompt_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 100
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}
async fn prompt_records(state: &AppState, id: &str) -> Result<Vec<Value>, ApiError> {
    let value = call(state, "beacon", &workspace(state, id)?, vec!["list".into()]).await?;
    value["prompts"]
        .as_array()
        .cloned()
        .ok_or_else(|| invalid("Beacon returned an incompatible prompt list"))
}
async fn render(
    state: &AppState,
    id: &str,
    name: &str,
    version: Option<u64>,
) -> Result<RenderedPrompt, ApiError> {
    if !valid_prompt_name(name) {
        return Err(invalid(
            "Prompt names must be bounded letters, digits, dashes or underscores",
        ));
    }
    // A historical pin is not permission to silently ignore a changed current prompt.
    let records = prompt_records(state, id).await?;
    let current = records
        .iter()
        .find(|value| value["name"].as_str() == Some(name))
        .ok_or_else(not_found)?;
    let current_version = current["version"]
        .as_u64()
        .ok_or_else(|| invalid("Beacon prompt version is invalid"))?;
    if version.is_some_and(|expected| expected != current_version) {
        return Err(conflict(
            "Beacon prompt changed; preview and select its current version",
        ));
    }
    let raw = call(
        state,
        "beacon",
        &workspace(state, id)?,
        vec!["render".into(), format!("{name}@{current_version}")],
    )
    .await?;
    // Beacon render resolves content without applying its optional schemas.
    // Bind every contributing source and schema so changes that preserve the
    // displayed text still invalidate the selected prompt's approval evidence.
    let chain = raw["resolvedFrom"]
        .as_array()
        .filter(|chain| !chain.is_empty() && chain.len() <= 64)
        .ok_or_else(|| conflict("Beacon returned an incompatible prompt source chain"))?;
    let directory = workspace(state, id)?;
    let mut sources = Vec::new();
    let mut schemas = std::collections::BTreeMap::new();
    for source_name in chain {
        let source_name = source_name
            .as_str()
            .ok_or_else(|| conflict("Beacon prompt source identity is invalid"))?;
        if sources
            .iter()
            .any(|source: &Value| source["name"].as_str() == Some(source_name))
        {
            continue;
        }
        let source=records.iter().find(|source| source["name"].as_str()==Some(source_name))
            .ok_or_else(|| conflict("Beacon prompt inheritance changed or contains an archived source; refresh before continuing"))?;
        if let Some(schema) = source.get("schema").filter(|schema| !schema.is_null()) {
            let schema_name = schema
                .as_str()
                .filter(|name| !name.is_empty() && name.len() <= 100 && !name.starts_with('-'))
                .ok_or_else(|| conflict("Beacon prompt schema identity is invalid"))?;
            let validation=call(state,"beacon",&directory,vec!["validate".into(),source_name.into()]).await
                .map_err(|_| conflict("Beacon prompt schema validation failed; repair the managed prompt or schema before continuing"))?;
            if validation["valid"] != true
                || !validation["errors"].as_array().is_some_and(Vec::is_empty)
                || !validation["warnings"].as_array().is_some_and(Vec::is_empty)
            {
                return Err(conflict("Beacon prompt schema validation returned errors or warnings; repair it before continuing"));
            }
            if !schemas.contains_key(schema_name) {
                let shown = call(
                    state,
                    "beacon",
                    &directory,
                    vec!["schema".into(), "show".into(), schema_name.into()],
                )
                .await
                .map_err(|_| {
                    conflict("Beacon prompt schema is unavailable; repair it before continuing")
                })?;
                let schema = shown["schema"]
                    .as_object()
                    .filter(|schema| {
                        schema.get("name").and_then(Value::as_str) == Some(schema_name)
                    })
                    .ok_or_else(|| conflict("Beacon returned an incompatible schema record"))?;
                schemas.insert(schema_name.to_owned(), Value::Object(schema.clone()));
            }
        }
        sources.push(source.clone());
    }
    let sections = raw["sections"]
        .as_array()
        .ok_or_else(|| invalid("Beacon rendered an incompatible prompt"))?;
    let mut body = String::new();
    for section in sections {
        let name = section["name"]
            .as_str()
            .ok_or_else(|| invalid("Beacon section name is invalid"))?;
        let text = section["body"]
            .as_str()
            .ok_or_else(|| invalid("Beacon section body is invalid"))?;
        body.push_str(&format!("## {name}\n{text}\n"));
    }
    if body.len() > 24_000 {
        return Err(invalid(
            "Rendered prompt exceeds the approved resource limit",
        ));
    }
    Ok(RenderedPrompt {
        name: name.into(),
        version: current_version,
        hash: hash_value(&json!({"rendered":raw,"sources":sources,"schemas":schemas}))
            .map_err(internal)?,
        body,
    })
}
pub async fn list_prompts(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Vec<Value>>, ApiError> {
    require_enabled(&state, &id)?;
    let _guard = state.component_locks.lock().await;
    let rows = prompt_records(&state, &id).await?;
    Ok(Json(
        rows.into_iter()
            .map(|value| json!({"name":value["name"],"version":value["version"]}))
            .collect(),
    ))
}
pub async fn render_prompt(
    State(state): State<AppState>,
    Path((id, name)): Path<(String, String)>,
    Query(query): Query<PromptQuery>,
) -> Result<Json<RenderedPrompt>, ApiError> {
    require_enabled(&state, &id)?;
    let _guard = state.component_locks.lock().await;
    Ok(Json(render(&state, &id, &name, query.version).await?))
}
pub async fn create_prompt(
    State(state): State<AppState>,
    Path(id): Path<String>,
    Json(request): Json<CreatePrompt>,
) -> Result<Json<RenderedPrompt>, ApiError> {
    require_enabled(&state, &id)?;
    if !valid_prompt_name(&request.name)
        || request.body.trim().is_empty()
        || request.body.len() > 16_000
    {
        return Err(invalid(
            "Prompts require a bounded name and nonempty content",
        ));
    }
    let _guard = state.component_locks.lock().await;
    let operation=state.store.lock().map_err(internal)?.begin_component_operation(&id,&request.idempotency_key,"prompt.create",&json!({"name":request.name,"body":request.body,"expected_version":request.expected_version}),&format!("prompt-{}",uuid::Uuid::new_v4())).map_err(|_| conflict("Prompt idempotency key conflicts with a previous request"))?;
    if let Some(response) = operation.response {
        return Ok(Json(serde_json::from_value(response).map_err(internal)?));
    }
    let records = prompt_records(&state, &id).await?;
    if let Some(existing) = records
        .iter()
        .find(|value| value["name"].as_str() == Some(&request.name))
    {
        if existing["frontmatter"]["luuna_request"].as_str() != Some(&operation.record_id) {
            if operation.attempted {
                return Err(conflict("Uncertain Beacon update cannot be reconciled; inspect the managed source before retrying"));
            }
            let expected=request.expected_version.filter(|version| *version>0).ok_or_else(|| conflict("A Beacon prompt with that name already exists; preview its current version before updating"))?;
            if existing["version"].as_u64() != Some(expected) {
                return Err(conflict(
                    "Beacon prompt changed since preview; refresh before updating",
                ));
            }
            state
                .store
                .lock()
                .map_err(internal)?
                .mark_component_operation_attempted(&id, &request.idempotency_key)
                .map_err(internal)?;
            call(
                &state,
                "beacon",
                &workspace(&state, &id)?,
                vec![
                    "update".into(),
                    request.name.clone(),
                    "--section".into(),
                    format!("guidance={}", request.body),
                    "--fm".into(),
                    format!("luuna_request={}", operation.record_id),
                ],
            )
            .await?;
        }
    } else {
        if request.expected_version.is_some_and(|version| version != 0) {
            return Err(conflict("The Beacon prompt to update no longer exists"));
        }
        if operation.attempted {
            return Err(conflict("Uncertain Beacon create cannot be reconciled; inspect the managed source before retrying"));
        }
        state
            .store
            .lock()
            .map_err(internal)?
            .mark_component_operation_attempted(&id, &request.idempotency_key)
            .map_err(internal)?;
        call(
            &state,
            "beacon",
            &workspace(&state, &id)?,
            vec![
                "create".into(),
                "--name".into(),
                request.name.clone(),
                "--section".into(),
                format!("guidance={}", request.body),
                "--fm".into(),
                format!("luuna_request={}", operation.record_id),
            ],
        )
        .await?;
    }
    let result = render(&state, &id, &request.name, None).await?;
    if result.version != request.expected_version.unwrap_or(0).saturating_add(1) {
        return Err(conflict(
            "Beacon advanced during the operation; refresh and reconcile before retrying",
        ));
    }
    let records = prompt_records(&state, &id).await?;
    let written = records
        .iter()
        .find(|record| record["name"].as_str() == Some(&request.name))
        .ok_or_else(|| conflict("Beacon prompt disappeared during the operation"))?;
    if written["frontmatter"]["luuna_request"].as_str() != Some(&operation.record_id)
        || !written["sections"].as_array().is_some_and(|sections| {
            sections.iter().any(|section| {
                section["name"] == "guidance" && section["body"].as_str() == Some(&request.body)
            })
        })
    {
        return Err(conflict(
            "Uncertain prompt write differs from the original request",
        ));
    }
    state
        .store
        .lock()
        .map_err(internal)?
        .complete_component_operation(
            &id,
            &request.idempotency_key,
            &serde_json::to_value(&result).map_err(internal)?,
        )
        .map_err(internal)?;
    Ok(Json(result))
}

#[derive(Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct SelectContext {
    #[serde(default)]
    pub memory_ids: Vec<String>,
    pub prompt: Option<PromptReference>,
}
pub(crate) async fn resolve_selection(
    state: &AppState,
    id: &str,
    selection: Option<&SelectContext>,
) -> Result<Option<ComponentContext>, ApiError> {
    let Some(selection) = selection else {
        return Ok(None);
    };
    require_enabled(state, id)?;
    if selection.memory_ids.len() > 16 {
        return Err(invalid("At most sixteen memories may be selected"));
    }
    let bindings = state
        .store
        .lock()
        .map_err(internal)?
        .memory_bindings(id, true)
        .map_err(internal)?;
    let mut memory = Vec::new();
    for selected in &selection.memory_ids {
        if memory
            .iter()
            .any(|value: &MemoryReference| &value.id == selected)
        {
            return Err(invalid("Duplicate memory selection"));
        }
        let binding = bindings
            .iter()
            .find(|value| &value.id == selected)
            .ok_or_else(|| invalid("Selected memory is absent or belongs to another project"))?;
        let record = resolved_memory(state, binding).await?;
        memory.push(MemoryReference {
            id: record.id,
            scope: record.scope,
            hash: record.hash,
            content: record.content,
            provenance: record.provenance,
        });
    }
    let prompt = if let Some(reference) = &selection.prompt {
        let rendered = render(state, id, &reference.name, Some(reference.version)).await?;
        if rendered.hash != reference.hash {
            return Err(conflict(
                "Beacon prompt changed since preview; select it again",
            ));
        }
        Some(ApprovedPrompt {
            name: rendered.name,
            version: rendered.version,
            hash: rendered.hash,
            body: rendered.body,
        })
    } else {
        None
    };
    let context = ComponentContext { memory, prompt };
    if serde_json::to_vec(&context).map_err(internal)?.len() > 16_000 {
        return Err(invalid(
            "Selected component context exceeds the 16000-byte session resource limit",
        ));
    }
    Ok(Some(context))
}
pub(crate) async fn resolve_approved(
    state: &AppState,
    id: &str,
    context: Option<&ComponentContext>,
) -> Result<Option<Value>, ApiError> {
    let Some(context) = context else {
        return Ok(None);
    };
    require_enabled(state, id)?;
    let bindings = state
        .store
        .lock()
        .map_err(internal)?
        .memory_bindings(id, context.memory.iter().any(|value| value.scope == "user"))
        .map_err(internal)?;
    let mut selected = Vec::new();
    for reference in &context.memory {
        let binding = bindings
            .iter()
            .find(|value| value.id == reference.id)
            .ok_or_else(|| conflict("Approved memory was deleted or moved; create a new plan"))?;
        let record = resolved_memory(state, binding).await?;
        if record.hash != reference.hash
            || record.scope != reference.scope
            || record.content != reference.content
            || record.provenance != reference.provenance
        {
            return Err(conflict(
                "Approved Atlas memory changed; create and approve a new plan",
            ));
        }
        selected.push(json!({"id":record.id,"scope":record.scope,"provenance":record.provenance,"content":record.content,"hash":record.hash}));
    }
    let prompt = if let Some(reference) = &context.prompt {
        let rendered = render(state, id, &reference.name, Some(reference.version)).await?;
        if rendered.hash != reference.hash || rendered.body != reference.body {
            return Err(conflict(
                "Approved Beacon prompt changed; create and approve a new plan",
            ));
        }
        Some(rendered)
    } else {
        None
    };
    let value = json!({"memory":selected,"prompt":prompt});
    if value.to_string().len() > 16_000 {
        return Err(invalid(
            "Selected component context exceeds the 16000-byte session resource limit",
        ));
    }
    Ok(Some(value))
}

pub(crate) async fn verify_plan_sources(
    state: &AppState,
    plan: &luuna_domain::PlanRevision,
) -> Result<Option<Value>, ApiError> {
    let _guard = state.component_locks.lock().await;
    let ticket = state
        .store
        .lock()
        .map_err(internal)?
        .get_ticket(&plan.ticket_id)
        .map_err(internal)?
        .ok_or_else(not_found)?;
    crate::missions::ensure_current(state, &ticket).await?;
    if ticket.revision != plan.ticket_revision {
        return Err(conflict(
            "Ticket changed since plan approval; create a new plan",
        ));
    }
    resolve_approved(state, &plan.project_id, plan.component_context.as_ref()).await
}
