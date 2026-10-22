//! A fake GitHub REST API on a loopback port, shared by the publication
//! tests: pull requests numbered per repository, every request it saw, and
//! the behaviours a scenario switches on per repository (a creation that
//! fails once, a creation delay, check runs on the head and a merge a person
//! performed). No real GitHub is ever involved, and the fake refuses every
//! route the runtime must never call (there is no merge endpoint).
#![allow(dead_code)]
use axum::{
    body::Body,
    extract::{Path as AxumPath, Query, State},
    http::{Request, StatusCode},
    routing::get,
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Default)]
pub struct FakeGitHub {
    pub requests: Vec<(String, String)>,
    /// Every pull request created, in creation order, across repositories;
    /// `base.repo.name` names its repository and numbers restart per repository.
    pub pull_requests: Vec<Value>,
    pub delay_create: Option<Duration>,
    /// Repositories whose next pull request creation answers 500 once.
    pub fail_create_once: BTreeSet<String>,
    /// Check runs reported for any head of the named repository.
    pub check_runs: BTreeMap<String, Vec<Value>>,
    /// Repositories whose pull requests a person has merged.
    pub merged: BTreeSet<String>,
}

pub type Fake = Arc<Mutex<FakeGitHub>>;

impl FakeGitHub {
    pub fn pull_requests_of(&self, repo: &str) -> Vec<Value> {
        self.pull_requests
            .iter()
            .filter(|pr| pr["base"]["repo"]["name"] == repo)
            .cloned()
            .collect()
    }
    pub fn pull_request(&self, repo: &str, number: u64) -> Option<Value> {
        self.pull_requests
            .iter()
            .find(|pr| pr["base"]["repo"]["name"] == repo && pr["number"] == number)
            .cloned()
    }
    pub fn count(&self, method: &str, path_part: &str) -> usize {
        self.requests
            .iter()
            .filter(|(m, p)| m == method && p.contains(path_part))
            .count()
    }
}

fn pull_request(number: u64, owner: &str, repo: &str, body: &Value) -> Value {
    json!({
        "number": number,
        "html_url": format!("https://github.com/{owner}/{repo}/pull/{number}"),
        "url": format!("https://api.github.com/repos/{owner}/{repo}/pulls/{number}"),
        "state": "open",
        "title": body["title"],
        "body": body["body"],
        "head": {"ref": body["head"], "sha": body["head_sha"]},
        "base": {"ref": body["base"], "repo": {"name": repo, "owner": {"login": owner}}},
        "merged": false,
        "merged_at": null,
        "merged_by": null,
    })
}

async fn list_pulls(
    State(fake): State<Fake>,
    AxumPath((owner, repo)): AxumPath<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Json<Value> {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/pulls?{query:?}"),
    ));
    let head = query.get("head").cloned().unwrap_or_default();
    let branch = head.split_once(':').map(|(_, b)| b.to_owned());
    let listed: Vec<Value> = fake
        .pull_requests_of(&repo)
        .into_iter()
        .filter(|pr| branch.as_deref().is_none_or(|b| pr["head"]["ref"] == b))
        .collect();
    Json(Value::Array(listed))
}

async fn create_pull(
    State(fake): State<Fake>,
    AxumPath((owner, repo)): AxumPath<(String, String)>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let (delay, response) = {
        let mut fake = fake.lock().unwrap();
        fake.requests
            .push(("POST".into(), format!("/repos/{owner}/{repo}/pulls")));
        if fake.fail_create_once.remove(&repo) {
            (
                None,
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(json!({"message": "synthetic outage"})),
                ),
            )
        } else {
            let number = fake.pull_requests_of(&repo).len() as u64 + 1;
            let pr = pull_request(number, &owner, &repo, &body);
            fake.pull_requests.push(pr.clone());
            (fake.delay_create, (StatusCode::CREATED, Json(pr)))
        }
    };
    if let Some(delay) = delay {
        tokio::time::sleep(delay).await;
    }
    response
}

async fn get_pull(
    State(fake): State<Fake>,
    AxumPath((owner, repo, number)): AxumPath<(String, String, u64)>,
) -> (StatusCode, Json<Value>) {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/pulls/{number}"),
    ));
    let merged = fake.merged.contains(&repo);
    match fake.pull_request(&repo, number) {
        Some(mut pr) => {
            if merged {
                pr["merged"] = json!(true);
                pr["merged_at"] = json!("2026-10-21T12:00:00Z");
                pr["merged_by"] = json!({"login": "a-human"});
                pr["state"] = json!("closed");
            }
            (StatusCode::OK, Json(pr))
        }
        None => (StatusCode::NOT_FOUND, Json(json!({"message": "Not Found"}))),
    }
}

async fn patch_pull(
    State(fake): State<Fake>,
    AxumPath((owner, repo, number)): AxumPath<(String, String, u64)>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "PATCH".into(),
        format!("/repos/{owner}/{repo}/pulls/{number}"),
    ));
    match fake
        .pull_requests
        .iter_mut()
        .find(|pr| pr["base"]["repo"]["name"] == repo && pr["number"] == number)
    {
        Some(pr) => {
            pr["body"] = body["body"].clone();
            (StatusCode::OK, Json(pr.clone()))
        }
        None => (StatusCode::NOT_FOUND, Json(json!({"message": "Not Found"}))),
    }
}

async fn check_runs(
    State(fake): State<Fake>,
    AxumPath((owner, repo, sha)): AxumPath<(String, String, String)>,
) -> Json<Value> {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/commits/{sha}/check-runs"),
    ));
    let runs = fake.check_runs.get(&repo).cloned().unwrap_or_default();
    Json(json!({"total_count": runs.len(), "check_runs": runs}))
}

async fn combined_status(
    State(fake): State<Fake>,
    AxumPath((owner, repo, sha)): AxumPath<(String, String, String)>,
) -> Json<Value> {
    let mut fake = fake.lock().unwrap();
    fake.requests.push((
        "GET".into(),
        format!("/repos/{owner}/{repo}/commits/{sha}/status"),
    ));
    Json(json!({"state": "pending", "statuses": []}))
}

async fn fallback(State(fake): State<Fake>, request: Request<Body>) -> (StatusCode, Json<Value>) {
    fake.lock().unwrap().requests.push((
        request.method().to_string(),
        request.uri().path().to_owned(),
    ));
    (StatusCode::NOT_FOUND, Json(json!({"message": "Not Found"})))
}

/// Serve the fake on a loopback port; returns it and its base URL.
pub async fn start_fake_github() -> (Fake, String) {
    let fake: Fake = Arc::default();
    let app = Router::new()
        .route(
            "/repos/{owner}/{repo}/pulls",
            get(list_pulls).post(create_pull),
        )
        .route(
            "/repos/{owner}/{repo}/pulls/{number}",
            get(get_pull).patch(patch_pull),
        )
        .route(
            "/repos/{owner}/{repo}/commits/{sha}/check-runs",
            get(check_runs),
        )
        .route(
            "/repos/{owner}/{repo}/commits/{sha}/status",
            get(combined_status),
        )
        .fallback(fallback)
        .with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (fake, format!("http://{address}"))
}

/// Every request the fake saw must be a read, a pull request creation or a
/// body update: Luuna never merges, closes or deletes anything on GitHub.
pub fn assert_no_merge_requests(fake: &Fake) {
    let requests = fake.lock().unwrap().requests.clone();
    assert!(
        requests.iter().all(
            |(method, path)| !path.to_ascii_lowercase().contains("merge")
                && method != "PUT"
                && method != "DELETE"
        ),
        "Luuna sent a merge-like request: {requests:?}"
    );
    assert!(requests
        .iter()
        .all(|(m, p)| m != "POST" || p.ends_with("/pulls")));
}
