use luuna_storage::{RunRecord, Store};
use rusqlite::{params, Connection};
use std::{hint::black_box, time::Instant};

fn seed(connection: &mut Connection, count: usize) {
    let tx = connection.transaction().unwrap();
    for index in 0..count {
        let id = format!("history-{index:05}");
        let timestamp = format!("2026-10-{:02}T00:00:00Z", index % 20 + 1);
        tx.execute("INSERT INTO runs(id,project_id,state,revision,metadata,created_at,updated_at) VALUES (?1,'project','\"completed\"',7,?2,?3,?3)",
            params![id, serde_json::json!({"prompt": format!("fixture {index}"), "nested": {"preserved": true}}).to_string(), timestamp]).unwrap();
        tx.execute("INSERT INTO projects(id,name,revision,manifest_hash,created_at,updated_at) VALUES (?1,?1,0,NULL,?2,?2)", params![id, timestamp]).unwrap();
    }
    tx.commit().unwrap();
}

// The original history path: one ID query followed by one lookup per record.
fn original_runs(connection: &Connection, store: &Store) -> Vec<RunRecord> {
    let mut statement = connection
        .prepare("SELECT id FROM runs ORDER BY created_at DESC,id")
        .unwrap();
    let ids = statement
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap();
    ids.map(|id| store.get_run(&id.unwrap()).unwrap().unwrap())
        .collect()
}

#[test]
fn history_preserves_order_and_every_field_across_reopen() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.db");
    let store = Store::open(&path).unwrap();
    assert!(store.runs().unwrap().is_empty());
    assert!(store.projects().unwrap().is_empty());
    let mut connection = Connection::open(&path).unwrap();
    seed(&mut connection, 1500);
    let runs = store.runs().unwrap();
    assert_eq!(runs, original_runs(&connection, &store));
    assert_eq!(runs.len(), 1500);
    let projects = store.projects().unwrap();
    assert_eq!(projects.len(), 1500);
    for project in &projects {
        assert_eq!(
            Some(project.clone()),
            store.get_project(&project.id).unwrap()
        );
    }
    assert_eq!(
        projects.iter().map(|p| &p.id).collect::<Vec<_>>(),
        runs.iter().map(|r| &r.id).collect::<Vec<_>>()
    );
    drop(store);
    let reopened = Store::open(&path).unwrap();
    assert_eq!(runs, reopened.runs().unwrap());
    assert_eq!(projects, reopened.projects().unwrap());
    // Corrupt persisted JSON must still fail, never silently omit a record.
    connection
        .execute(
            "UPDATE runs SET metadata='invalid' WHERE id='history-00000'",
            [],
        )
        .unwrap();
    assert!(reopened.runs().is_err());
    assert!(reopened.get_run("history-00000").is_err());
}

#[test]
#[ignore = "manual synthetic performance measurement; no timing threshold in CI"]
fn history_benchmark() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("history.db");
    let store = Store::open(&path).unwrap();
    let mut connection = Connection::open(&path).unwrap();
    seed(&mut connection, 10_000);
    assert_eq!(store.runs().unwrap(), original_runs(&connection, &store));
    let mut before = Vec::new();
    let mut after = Vec::new();
    let mut page = Vec::new();
    for _ in 0..9 {
        let start = Instant::now();
        black_box(original_runs(&connection, &store));
        before.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        black_box(store.runs().unwrap());
        after.push(start.elapsed().as_secs_f64() * 1000.0);
        let start = Instant::now();
        black_box(store.runs_page(None, None, 200).unwrap());
        page.push(start.elapsed().as_secs_f64() * 1000.0);
    }
    before.sort_by(f64::total_cmp);
    after.sort_by(f64::total_cmp);
    page.sort_by(f64::total_cmp);
    println!("10000 runs, 9 warmed samples, median ms: original={:.3}, single_select={:.3}, speedup={:.2}x", before[4], after[4], before[4] / after[4]);
    println!(
        "first 200 runs from indexed history, median ms: {:.3}",
        page[4]
    );
}

#[test]
fn keyset_pages_match_full_history_with_ties_and_project_filters() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("pages.db");
    let mut store = Store::open(&path).unwrap();
    seed(&mut Connection::open(&path).unwrap(), 501);
    let expected = store.runs().unwrap();
    let mut collected = Vec::new();
    loop {
        let next = store
            .runs_page(
                collected.last().map(|r: &RunRecord| r.id.as_str()),
                Some("project"),
                200,
            )
            .unwrap();
        if next.is_empty() {
            break;
        }
        assert!(next.len() <= 200);
        collected.extend(next);
    }
    assert_eq!(expected, collected);
    let first = store.runs_page(None, None, 200).unwrap();
    store
        .create_run("new", "other", serde_json::json!({}))
        .unwrap();
    assert_eq!(
        store.runs_page(Some(&first[199].id), None, 200).unwrap(),
        expected[200..400]
    );
    assert_eq!(store.runs_page(None, Some("other"), 200).unwrap().len(), 1);
}

#[test]
fn event_pages_have_byte_bounds_and_reconstruct_both_directions() {
    let mut store = Store::open(":memory:").unwrap();
    store.create_run("run", "p", serde_json::json!({})).unwrap();
    for _ in 0..7 {
        store
            .append_event(
                "run",
                "fixture",
                serde_json::json!({"text":"x".repeat(400_000)}),
            )
            .unwrap();
    }
    let expected = store.events_after("run", 0).unwrap();
    let mut after = 0;
    let mut all = Vec::new();
    loop {
        let next = store.events_page("run", after, None, 200).unwrap();
        if next.is_empty() {
            break;
        }
        assert!(serde_json::to_vec(&next).unwrap().len() <= 1024 * 1024);
        after = next.last().unwrap().sequence;
        all.extend(next);
    }
    assert_eq!(
        serde_json::to_value(&all).unwrap(),
        serde_json::to_value(&expected).unwrap()
    );
    let reverse = store.events_page("run", 0, Some(9), 200).unwrap();
    assert_eq!(
        reverse.iter().map(|e| e.sequence).collect::<Vec<_>>(),
        vec![7, 8]
    );
    store
        .append_event(
            "run",
            "oversize",
            serde_json::json!({"text":"y".repeat(1_100_000)}),
        )
        .unwrap();
    assert_eq!(store.events_page("run", 8, None, 200).unwrap().len(), 1);
}
