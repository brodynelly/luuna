//! The command line's contract, against the built client and a mock runtime: parity with the
//! capability catalog (every entry has one command that issues its method and route), connection
//! and refusal sentences that never show a server body, usage errors, the full-hash approval
//! acknowledgment, the SSE follower's resumption, and help that needs no token.
mod support;
use serde_json::{json, Value};
use support::{json, run_client, serve, status, Reply, Request};

const HASH: &str = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN: &str = "test-token-0123456789";

fn plan() -> Value {
    json!({"id":"plan-1","revision":1,"ticket_id":"ticket-1","ticket_revision":1,"hash":HASH,"base_commits":{"app":"abc"},"tasks":[{"paths":["src"],"operations":["read","write"]}],"budgets":{"max_attempts":2,"timeout_seconds":600,"cost_usd_micros":1000000}})
}
fn run_record() -> Value {
    json!({"id":"run-1","project_id":"walkthrough","state":"completed","revision":3,"metadata":{"kind":"workflow"},"created_at":"2026-10-21T00:00:00Z","updated_at":"2026-10-21T00:00:00Z"})
}

/// Answers with records every command can use (the original parity test's mock).
fn records(request: &Request) -> Reply {
    let path = request.path.as_str();
    let ends = |suffix: &str| path.ends_with(suffix);
    let parts: Vec<&str> = path.trim_start_matches("/api/v1/").split('/').collect();
    if ends("/stream") {
        let after: u64 = request
            .header("Last-Event-ID")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        let event = json!({"schema_version":"0.1","event_id":"e1","sequence":after + 1,"timestamp":"2026-10-21T00:00:00Z","project_id":"walkthrough","run_id":"run-1","type":"run.completed","payload":{}});
        return Reply {
            status: 200,
            content_type: "text/event-stream",
            body: format!("event: run_event\nid: {}\ndata: {event}\n\n", after + 1),
        };
    }
    if path.contains("/artifacts/") {
        return Reply {
            status: 200,
            content_type: "text/plain",
            body: "Ran 1 test\n\nOK\n".into(),
        };
    }
    match parts.as_slice() {
        ["plans", _] => return json(plan()),
        ["plans", _, "approvals"] => {
            return json(
                json!({"approval":{"plan_id":"plan-1","plan_revision":1,"plan_hash":HASH,"approved_by":"developer"},"run":run_record()}),
            )
        }
        ["runs", _] => return json(run_record()),
        ["runs", _, "candidate"] => {
            return json(
                json!({"evidence":{"candidate":{"revision":1,"hash":HASH,"plan_hash":HASH,"repository_commits":{}},"status":"pending","results":[]},"active":false,"repair_allowed":false,"revalidate_allowed":false}),
            )
        }
        ["projects", _] if request.method == "GET" => {
            return json(
                json!({"project":{"id":"walkthrough","name":"Walkthrough","revision":0},"repositories":[{"repository_id":"app","local_path":"/srv/app","observation":{"identity":{},"dirty":{}}}],"manifest":null,"discovery":null}),
            )
        }
        ["tickets", _] if request.method == "GET" => {
            return json(
                json!({"id":"ticket-1","revision":1,"source":"luuna_sqlite_temporary","title":"t","intent":"i","acceptance_criteria":[],"repository_ids":["app"]}),
            )
        }
        _ => {}
    }
    if ends("/events") {
        return json(json!([]));
    }
    if ends("/plans") && request.method == "POST" {
        return json(json!({"plan":plan(),"run":run_record()}));
    }
    json(json!({}))
}

fn table() -> Value {
    serde_json::from_str(include_str!("../commands.json")).unwrap()
}
fn catalog() -> Value {
    serde_json::from_str(include_str!("../../../schemas/capability-catalog.json")).unwrap()
}
fn route_matches(route: &str, path: &str) -> bool {
    let a: Vec<&str> = route.split('/').collect();
    let b: Vec<&str> = path.split('/').collect();
    a.len() == b.len() && a.iter().zip(&b).all(|(x, y)| x.starts_with('{') || x == y)
}
fn argv_of(command: &Value) -> Vec<String> {
    let mut argv = vec![command["name"].as_str().unwrap().to_string()];
    argv.extend(
        command["example"]["args"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_string()),
    );
    for (flag, value) in command["example"]["flags"].as_object().unwrap() {
        let items = match value {
            Value::Array(items) => items.clone(),
            other => vec![other.clone()],
        };
        for item in items {
            if item == Value::Bool(true) {
                argv.push(format!("--{flag}"));
            } else {
                argv.push(format!("--{flag}"));
                argv.push(
                    item.as_str()
                        .map(str::to_string)
                        .unwrap_or_else(|| item.to_string()),
                );
            }
        }
    }
    argv
}

#[test]
fn every_catalog_entry_has_one_command_that_issues_its_method_and_route() {
    let table = table();
    let catalog = catalog();
    let capabilities = catalog["capabilities"].as_array().unwrap();
    let commands = table["commands"].as_array().unwrap();
    assert_eq!(commands.len(), capabilities.len());
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("luuna-walkthrough-export.json"), json!({"schema_version":"0.1","kind":"luuna-project-export","export_hash":format!("sha256:{}", "b".repeat(64)),"project":{"id":"walkthrough"}}).to_string()).unwrap();
    for capability in capabilities {
        let command = commands
            .iter()
            .find(|c| c["id"] == capability["id"])
            .unwrap_or_else(|| panic!("no command for {}", capability["id"]));
        assert_eq!(command["name"], capability["tui"]);
        let mock = serve(records);
        let mut argv = argv_of(command);
        argv.push("--json".into());
        let argv: Vec<&str> = argv.iter().map(String::as_str).collect();
        let (code, out, err) = run_client(
            &argv,
            &mock.url(),
            Some(TOKEN),
            &json!({"schema_version":"0.1","id":"walkthrough"}).to_string(),
            directory.path(),
        );
        let name = capability["tui"].as_str().unwrap();
        assert_eq!(code, 0, "{name} failed: {err}");
        let requests = mock.take();
        let method = capability["method"].as_str().unwrap();
        let route = capability["route"].as_str().unwrap();
        assert!(
            requests
                .iter()
                .any(|r| r.method == method && route_matches(route, &r.path)),
            "{name} issued {:?}, not {method} {route}",
            requests
                .iter()
                .map(|r| format!("{} {}", r.method, r.path))
                .collect::<Vec<_>>()
        );
        for request in &requests {
            assert_eq!(
                request.header("Authorization"),
                Some(format!("Bearer {TOKEN}").as_str())
            );
            assert!(!request.query.contains(TOKEN));
        }
        assert!(!out.trim().is_empty(), "{name}: a --json result is printed");
        for line in out.trim().lines() {
            serde_json::from_str::<Value>(line)
                .unwrap_or_else(|_| panic!("{name}: not JSON: {line}"));
        }
    }
}

#[test]
fn bodies_match_the_shared_builders() {
    let directory = tempfile::tempdir().unwrap();
    let mock = serve(records);
    let (code, _, err) = run_client(
        &[
            "register",
            "Walkthrough",
            "app",
            "/srv/walkthrough",
            "--id",
            "walkthrough",
            "--repository",
            "web=/srv/web",
            "--json",
        ],
        &mock.url(),
        Some(TOKEN),
        "",
        directory.path(),
    );
    assert_eq!(code, 0, "{err}");
    assert_eq!(
        mock.take()[0].json(),
        json!({"name":"Walkthrough","id":"walkthrough","repositories":[{"id":"app","path":"/srv/walkthrough"},{"id":"web","path":"/srv/web"}]})
    );
    let (code, _, err) = run_client(
        &[
            "plan",
            "ticket-1",
            "--task",
            "api=src>lib",
            "--task",
            "lib=lib;role=repository_lead",
            "--workers",
            "2",
            "--attempts",
            "3",
            "--key",
            "k4",
        ],
        &mock.url(),
        Some(TOKEN),
        "",
        directory.path(),
    );
    assert_eq!(code, 0, "{err}");
    let posted = mock
        .take()
        .into_iter()
        .find(|r| r.method == "POST")
        .unwrap();
    assert_eq!(
        posted.json(),
        json!({"tasks":[{"id":"api","repository_id":"api","paths":["src"],"operations":["read","write"],"depends_on":["lib"]},{"id":"lib","repository_id":"lib","paths":["lib"],"operations":["read"],"role":"repository_lead"}],"budgets":{"max_attempts":3,"max_workers":2},"idempotency_key":"k4"})
    );
    // Key order is part of the body: it is the order the original builder wrote.
    assert!(posted.body.starts_with(r#"{"tasks":[{"id":"api","repository_id":"api","paths":["src"],"operations":["read","write"],"depends_on":["lib"]}"#), "{}", posted.body);
}

#[test]
fn connection_and_refusal_sentences() {
    let directory = tempfile::tempdir().unwrap();
    let dir = directory.path();
    let (code, _, err) = run_client(&["health"], "http://127.0.0.1:1", None, "", dir);
    assert_eq!(code, 2);
    assert!(err.contains("LUUNA_API_TOKEN"));
    let (code, _, err) = run_client(&["health"], "http://127.0.0.1:1", Some(TOKEN), "", dir);
    assert_eq!(code, 1);
    assert!(
        err.starts_with("Connection refused: The runtime did not answer."),
        "{err}"
    );
    let server = serve(|_| Reply {
        status: 500,
        content_type: "text/html",
        body: "<html>stack trace with /secret/path</html>".into(),
    });
    let (code, _, err) = run_client(&["projects"], &server.url(), Some(TOKEN), "", dir);
    assert_eq!(code, 1);
    assert!(
        err.starts_with(
            "Project listing refused: The runtime reported an internal error (HTTP 500)."
        ),
        "{err}"
    );
    assert!(!err.contains("stack trace"));
    let rejected = serve(|_| status(401, ""));
    let (_, _, err) = run_client(&["projects"], &rejected.url(), Some(TOKEN), "", dir);
    assert!(
        err.contains("rejected this token") && err.contains("LUUNA_API_TOKEN"),
        "{err}"
    );
    let busy = serve(|_| {
        status(
            409,
            r#"{"error":"repository app already has an active writer; one writer per repository"}"#,
        )
    });
    let (code, out, err) = run_client(&["implement", "run-1"], &busy.url(), Some(TOKEN), "", dir);
    assert_eq!(code, 1);
    assert!(err.starts_with("Implementation refused: repository app already has an active writer; one writer per repository Another workflow's writer holds this repository."), "{err}");
    assert!(out.is_empty());
    let (_, out, _) = run_client(
        &["implement", "run-1", "--json"],
        &busy.url(),
        Some(TOKEN),
        "",
        dir,
    );
    assert!(serde_json::from_str::<Value>(out.trim()).unwrap()["error"]
        .as_str()
        .unwrap()
        .starts_with("Implementation refused:"));
    let (code, _, err) = run_client(&["health"], "http://example.com", Some(TOKEN), "", dir);
    assert_eq!(code, 1);
    assert!(err.contains("loopback"), "{err}");
}

#[test]
fn approval_needs_the_complete_plan_hash() {
    let directory = tempfile::tempdir().unwrap();
    let mock = serve(records);
    let (code, _, err) = run_client(
        &["approve", "plan-1"],
        &mock.url(),
        Some(TOKEN),
        "",
        directory.path(),
    );
    assert_eq!(code, 2);
    assert!(err.contains(&format!("--acknowledge-hash {HASH}")), "{err}");
    let wrong = format!("sha256:{}", "c".repeat(64));
    let (code, _, err) = run_client(
        &["approve", "plan-1", "--acknowledge-hash", &wrong],
        &mock.url(),
        Some(TOKEN),
        "",
        directory.path(),
    );
    assert_eq!(code, 1);
    assert!(
        err.starts_with("Approval refused: The acknowledged hash does not match plan plan-1 r1"),
        "{err}"
    );
    assert!(
        !mock.take().iter().any(|r| r.path.ends_with("/approvals")),
        "nothing is sent for a mismatched hash"
    );
    let (code, out, err) = run_client(
        &[
            "approve",
            "plan-1",
            "--acknowledge-hash",
            HASH,
            "--approved-by",
            "dev",
        ],
        &mock.url(),
        Some(TOKEN),
        "",
        directory.path(),
    );
    assert_eq!(code, 0, "{err}");
    let sent = mock
        .take()
        .into_iter()
        .find(|r| r.path.ends_with("/approvals"))
        .unwrap();
    assert_eq!(
        sent.json(),
        json!({"plan_revision":1,"plan_hash":HASH,"approved_by":"dev"})
    );
    assert!(out.contains("Approved plan plan-1 r1 by developer"));
}

#[test]
fn usage_errors_and_argument_parsing() {
    let directory = tempfile::tempdir().unwrap();
    let mock = serve(records);
    let run = |argv: &[&str]| run_client(argv, &mock.url(), Some(TOKEN), "", directory.path());
    let (code, _, err) = run(&["artifact", "run-1"]);
    assert_eq!(code, 2);
    assert!(
        err.contains("artifact needs 2 argument(s). Usage: artifact <run> <artifact-id>"),
        "{err}"
    );
    let (code, _, err) = run(&["frobnicate"]);
    assert_eq!(code, 2);
    assert!(err.contains("Unknown command frobnicate"));
    let (code, _, err) = run(&["create-ticket", "walkthrough", "--bogus", "x"]);
    assert_eq!(code, 2);
    assert!(err.contains("Unknown option --bogus"));
    let (code, _, err) = run(&["create-ticket", "walkthrough", "--title"]);
    assert_eq!(code, 2);
    assert!(err.contains("--title needs a value."));
    let (code, _, err) = run(&[
        "create-ticket",
        "walkthrough",
        "--title",
        "T",
        "--intent",
        "I",
        "--criterion",
        "a",
        "--criterion=b",
        "--repository",
        "app",
        "--key",
        "k",
        "--json",
    ]);
    assert_eq!(code, 0, "{err}");
    let body = mock
        .take()
        .into_iter()
        .find(|r| r.method == "POST")
        .unwrap()
        .json();
    assert_eq!(body["acceptance_criteria"], json!(["a", "b"]));
    let (code, out, _) = run(&[]);
    assert_eq!(code, 2);
    assert!(out.contains("luuna-tui <command>"));
}

#[test]
fn follow_resumes_with_last_event_id_and_prints_each_event() {
    let directory = tempfile::tempdir().unwrap();
    let mock = serve(records);
    let (code, out, err) = run_client(
        &["follow", "run-1", "--after", "0", "--json"],
        &mock.url(),
        Some(TOKEN),
        "",
        directory.path(),
    );
    assert_eq!(code, 0, "{err}");
    let lines: Vec<Value> = out
        .trim()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(lines[0]["sequence"], 1);
    assert_eq!(
        lines.last().unwrap(),
        &json!({"run_id":"run-1","state":"completed","last_sequence":1,"events_followed":1})
    );
    let stream = mock
        .take()
        .into_iter()
        .find(|r| r.path.ends_with("/stream"))
        .unwrap();
    assert_eq!(stream.header("Accept"), Some("text/event-stream"));
    let (code, _, _) = run_client(
        &["follow", "run-1", "--after", "7"],
        &mock.url(),
        Some(TOKEN),
        "",
        directory.path(),
    );
    assert_eq!(code, 0);
    assert_eq!(
        mock.take()
            .into_iter()
            .find(|r| r.path.ends_with("/stream"))
            .unwrap()
            .header("Last-Event-ID"),
        Some("7")
    );
}

#[test]
fn help_lists_every_command_once_and_needs_no_token() {
    let directory = tempfile::tempdir().unwrap();
    let dead = "http://127.0.0.1:1";
    let table = table();
    let (code, overview, _) = run_client(&["help"], dead, None, "", directory.path());
    assert_eq!(code, 0);
    for command in table["commands"]
        .as_array()
        .unwrap()
        .iter()
        .chain(table["projections"].as_array().unwrap())
        .chain(table["guides"].as_array().unwrap())
    {
        let name = command["name"].as_str().unwrap();
        let rows = overview
            .lines()
            .filter(|l| {
                // A command row starts at column 2; wrapped descriptions are indented further.
                l.strip_prefix("  ").is_some_and(|r| {
                    !r.starts_with(' ') && r.split_whitespace().next() == Some(name)
                })
            })
            .count();
        assert_eq!(rows, 1, "{name} is listed once");
        let (code, page, _) = run_client(&[name, "--help"], dead, None, "", directory.path());
        assert_eq!(code, 0);
        for flag in command["flags"].as_object().unwrap().keys() {
            assert!(page.contains(&format!("--{flag}")), "{name} --{flag}");
        }
    }
    assert!(overview.contains("luuna-tui missions"));
    let (code, _, err) = run_client(&["aprove"], dead, None, "", directory.path());
    assert_eq!(code, 2);
    assert!(err.contains("Did you mean approve?"));
    let (code, _, err) = run_client(&["init"], dead, Some(TOKEN), "", directory.path());
    assert_eq!(code, 2);
    assert!(
        err.contains("init is a guided setup and needs a terminal"),
        "{err}"
    );
    let (code, out, _) = run_client(&["catalog"], dead, None, "", directory.path());
    assert_eq!(code, 0);
    assert_eq!(serde_json::from_str::<Value>(&out).unwrap(), catalog());
}
