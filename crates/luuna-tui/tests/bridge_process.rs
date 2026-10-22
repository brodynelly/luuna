use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use luuna_tui::{
    bridge::{default_bridge, Bridge},
    protocol::ClientCommand,
};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

struct Fixture {
    url: String,
    approvals: Arc<AtomicUsize>,
    server: tokio::task::JoinHandle<()>,
}
impl Fixture {
    async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let approvals = Arc::new(AtomicUsize::new(0));
        let router=Router::new()
            .route("/api/v1/health",get(||async{Json(json!({"status":"ok"}))}))
            .route("/api/v1/projects",get(||async{Json(json!([]))}))
            .route("/api/v1/plans/p",get(||async{Json(json!({"id":"p","ticket_id":"t","revision":1,"hash":format!("sha256:{}","a".repeat(64)),"tasks":[],"base_commits":{},"budgets":{}}))}))
            .route("/api/v1/plans/p/approvals",post(|State(count):State<Arc<AtomicUsize>>,Json(_body):Json<serde_json::Value>|async move{
                count.fetch_add(1,Ordering::Relaxed);
                Json(json!({"approval":{"plan_id":"p","plan_revision":1,"plan_hash":format!("sha256:{}","a".repeat(64)),"approved_by":"developer"},"run":{"id":"r","state":"approved"}}))
            })).with_state(approvals.clone());
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        Self {
            url,
            approvals,
            server,
        }
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.server.abort();
    }
}
fn node() -> PathBuf {
    std::env::var_os("LUUNA_TEST_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("node"))
}
async fn next(bridge: &mut Bridge, id: &str, kind: &str) -> luuna_tui::protocol::BridgeEvent {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let event = bridge
                .recv()
                .await
                .expect("bridge open")
                .expect("valid frame");
            if event.id == id && event.event == kind {
                return event;
            }
            if event.id == id && event.event == "error" {
                panic!("Expected {kind}, got bridge error: {:?}", event.fields);
            }
        }
    })
    .await
    .unwrap_or_else(|_| panic!("bridge response deadline for {id}/{kind}"))
}

#[tokio::test]
async fn actual_node_process_catalog_read_fresh_hash_and_shutdown() {
    let fixture = Fixture::start().await;
    let mut bridge = Bridge::spawn(
        &node(),
        &default_bridge(),
        "synthetic-token",
        Some(&fixture.url),
    )
    .unwrap();
    bridge
        .send(&ClientCommand::new("catalog", "catalog", json!({})))
        .unwrap();
    let catalog = next(&mut bridge, "catalog", "catalog").await;
    let commands = catalog.fields["commands"].as_array().unwrap();
    assert_eq!(commands.len(), 61);
    assert!(commands.iter().any(|c| c["name"] == "home"));
    bridge
        .send(&ClientCommand::new(
            "projects",
            "read",
            json!({"name":"projects","args":[],"flags":{}}),
        ))
        .unwrap();
    assert_eq!(
        next(&mut bridge, "projects", "result").await.fields["value"],
        json!([])
    );
    bridge
        .send(&ClientCommand::new(
            "approve",
            "invoke",
            json!({"name":"approve","args":["p"],"flags":{}}),
        ))
        .unwrap();
    let plan = next(&mut bridge, "approve", "output").await;
    assert!(plan.text("text").contains("Immutable plan hash"));
    let prompt = next(&mut bridge, "approve", "prompt").await;
    assert_eq!(prompt.text("kind"), "hash");
    assert_eq!(fixture.approvals.load(Ordering::Relaxed), 0);
    bridge
        .send(&ClientCommand::new(
            "reply",
            "reply",
            json!({"request_id":"approve","prompt_id":prompt.text("prompt_id"),"value":"wrong"}),
        ))
        .unwrap();
    assert_eq!(
        next(&mut bridge, "approve", "error").await.text("outcome"),
        "refused"
    );
    assert_eq!(fixture.approvals.load(Ordering::Relaxed), 0);
    bridge
        .send(&ClientCommand::new(
            "approve2",
            "invoke",
            json!({"name":"approve","args":["p"],"flags":{}}),
        ))
        .unwrap();
    let prompt = next(&mut bridge, "approve2", "prompt").await;
    bridge.send(&ClientCommand::new("reply2","reply",json!({"request_id":"approve2","prompt_id":prompt.text("prompt_id"),"value":format!("sha256:{}","a".repeat(64))}))).unwrap();
    next(&mut bridge, "approve2", "result").await;
    assert_eq!(fixture.approvals.load(Ordering::Relaxed), 1);
    bridge.shutdown().await;
    assert!(bridge.process_id().is_none());
}

#[tokio::test]
async fn malicious_child_frame_is_bounded_and_owned_child_reaped() {
    let temporary = tempfile::tempdir().unwrap();
    let script = temporary.path().join("bad.mjs");
    std::fs::write(
        &script,
        "process.stdout.write('x'.repeat(1024*1024+1));setInterval(()=>{},1000);",
    )
    .unwrap();
    let mut bridge = Bridge::spawn(&node(), &script, "synthetic-token", None).unwrap();
    let result = tokio::time::timeout(Duration::from_secs(10), bridge.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(result.is_err());
    bridge.shutdown().await;
    assert!(bridge.process_id().is_none());
}
