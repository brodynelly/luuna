//! A real runtime process hard-killed during an active stage (ADR 0015). The
//! built binary is SIGKILLed while a baseline check runs, so no in-process
//! supervisor settles anything: the restarted process must recover from disk
//! alone. The same data directory exercises the `backup` (while running),
//! `restore` (refused while running) and `check` commands.
#![cfg(unix)]

use serde_json::{json, Value};
use std::{
    io::{BufRead, BufReader, Read, Write},
    net::TcpStream,
    path::Path,
    process::{Child, Command, Output, Stdio},
    time::{Duration, Instant},
};

const TOKEN: &str = "synthetic-restart-token-with-at-least-32-bytes";
const BINARY: &str = env!("CARGO_BIN_EXE_luuna-runtime");

struct Runtime {
    child: Child,
    address: String,
}

impl Runtime {
    /// Start the binary on an OS-assigned loopback port with a minimal
    /// environment: no provider credential or user configuration reaches it.
    fn start(data: &Path, home: &Path) -> Self {
        let mut child = Command::new(BINARY)
            .env_clear()
            .env("PATH", std::env::var_os("PATH").unwrap_or_default())
            .env("HOME", home)
            .env("LUUNA_API_TOKEN", TOKEN)
            .env("LUUNA_DATA_DIR", data)
            .env("LUUNA_PORT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let stderr = child.stderr.take().unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        // Keep draining stderr so the runtime never blocks on a full pipe.
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if let Some(at) = line.find("http://") {
                    let address = line[at + "http://".len()..]
                        .split_whitespace()
                        .next()
                        .unwrap_or_default()
                        .trim_end_matches('/')
                        .to_owned();
                    let _ = sender.send(address);
                }
            }
        });
        let address = receiver
            .recv_timeout(Duration::from_secs(60))
            .expect("the runtime reports its loopback address");
        Self { child, address }
    }

    fn request(&self, method: &str, path: &str, body: Option<Value>) -> (u16, Value) {
        let mut stream = TcpStream::connect(&self.address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(30)))
            .unwrap();
        let body = body.map(|value| value.to_string()).unwrap_or_default();
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {TOKEN}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            self.address,
            body.len()
        )
        .unwrap();
        let mut response = Vec::new();
        stream.read_to_end(&mut response).unwrap();
        let response = String::from_utf8_lossy(&response);
        let (head, payload) = response.split_once("\r\n\r\n").unwrap();
        let status = head.split_whitespace().nth(1).unwrap().parse().unwrap();
        let payload = if head
            .to_ascii_lowercase()
            .contains("transfer-encoding: chunked")
        {
            dechunk(payload)
        } else {
            payload.to_owned()
        };
        (
            status,
            serde_json::from_str(&payload).unwrap_or(Value::Null),
        )
    }

    fn events(&self, run: &str) -> Vec<Value> {
        let (status, events) = self.request("GET", &format!("/api/v1/runs/{run}/events"), None);
        assert_eq!(status, 200, "{events}");
        events.as_array().cloned().unwrap_or_default()
    }

    fn terminal(&self, run: &str) -> Value {
        let deadline = Instant::now() + Duration::from_secs(60);
        loop {
            let (_, record) = self.request("GET", &format!("/api/v1/runs/{run}"), None);
            if matches!(
                record["state"].as_str(),
                Some("completed" | "failed" | "cancelled" | "interrupted")
            ) {
                return record;
            }
            assert!(Instant::now() < deadline, "run {run} did not settle");
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// The authenticated orderly stop; the process must exit cleanly.
    fn shutdown(mut self) {
        let (status, _) = self.request("POST", "/api/v1/shutdown", None);
        assert_eq!(status, 202);
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            if let Some(exit) = self.child.try_wait().unwrap() {
                assert!(exit.success(), "{exit:?}");
                return;
            }
            assert!(Instant::now() < deadline, "runtime did not exit");
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

impl Drop for Runtime {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// A process group the killed runtime left behind; reaped when the test ends.
struct Orphan(i32);

impl Drop for Orphan {
    fn drop(&mut self) {
        // SAFETY: signals only the check's own process group, by its leader PID.
        unsafe {
            libc::kill(-self.0, libc::SIGKILL);
        }
    }
}

fn dechunk(mut body: &str) -> String {
    let mut out = String::new();
    while let Some((size, rest)) = body.split_once("\r\n") {
        let size = usize::from_str_radix(size.trim(), 16).unwrap_or(0);
        if size == 0 {
            break;
        }
        out.push_str(&rest[..size]);
        body = rest[size..].trim_start_matches("\r\n");
    }
    out
}

fn admin(arguments: &[&str]) -> Output {
    Command::new(BINARY)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .args(arguments)
        .output()
        .unwrap()
}

fn git(dir: &Path, args: &[&str]) {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_AUTHOR_NAME", "Fixture")
        .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
        .env("GIT_COMMITTER_NAME", "Fixture")
        .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn repository(dir: &Path) {
    git(dir, &["init", "-q", "-b", "main"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
    std::fs::write(dir.join("README.md"), "fixture\n").unwrap();
    std::fs::write(
        dir.join("pyproject.toml"),
        "[project]\nname = \"fixture\"\n",
    )
    .unwrap();
    git(dir, &["add", "."]);
    git(dir, &["commit", "-q", "-m", "initial"]);
    git(
        dir,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/fixture.git",
        ],
    );
}

fn manifest(revision: u64, code: &str) -> Value {
    json!({
        "schema_version": "0.1", "id": "fixture", "name": "Fixture", "revision": revision,
        "repositories": [{"id": "app", "remote": "https://example.invalid/fixture.git", "default_branch": "main",
            "profiles": ["python"], "execution": "native",
            "checks": [{"id": "unit", "executable": "python3", "args": ["-c", code], "required": true,
                "timeout_seconds": 300, "capabilities": ["python"], "cwd": "."}]}],
        "relationships": [],
        "policy": {"approval": "plan", "testing_prerequisite": true, "publish": "automatic_pr", "merge": "human",
            "max_explorers": 1, "max_implementers": 1, "max_task_repairs": 2},
    })
}

fn confirm(runtime: &Runtime, revision: u64, code: &str) {
    let (status, view) = runtime.request(
        "PUT",
        "/api/v1/projects/fixture/manifest",
        Some(json!({"expected_revision": revision, "manifest": manifest(revision + 1, code)})),
    );
    assert_eq!(status, 200, "{view}");
}

fn start_baseline(runtime: &Runtime) -> String {
    let (status, run) = runtime.request(
        "POST",
        "/api/v1/projects/fixture/baselines",
        Some(json!({"repository_id": "app", "include_optional": false})),
    );
    assert_eq!(status, 202, "{run}");
    run["id"].as_str().unwrap().to_owned()
}

#[test]
fn a_damaged_database_stops_startup_with_the_restore_command() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    std::fs::create_dir_all(&data).unwrap();
    let database = data.join("luuna.sqlite3");
    let damaged = "this is not a SQLite database\n".repeat(200);
    std::fs::write(&database, &damaged).unwrap();
    let mut child = Command::new(BINARY)
        .env_clear()
        .env("PATH", std::env::var_os("PATH").unwrap_or_default())
        .env("HOME", root.path())
        .env("LUUNA_API_TOKEN", TOKEN)
        .env("LUUNA_DATA_DIR", &data)
        .env("LUUNA_PORT", "0")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(60);
    let exit = loop {
        if let Some(exit) = child.try_wait().unwrap() {
            break exit;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            panic!("the runtime started on a damaged database");
        }
        std::thread::sleep(Duration::from_millis(50));
    };
    let mut stderr = String::new();
    child
        .stderr
        .take()
        .unwrap()
        .read_to_string(&mut stderr)
        .unwrap();
    assert!(!exit.success());
    // The service's own refusal is actionable, not a debug dump.
    assert!(stderr.contains("failed its integrity check"), "{stderr}");
    assert!(stderr.contains("luuna-runtime restore --input"), "{stderr}");
    assert_eq!(std::fs::read_to_string(&database).unwrap(), damaged);
}

#[test]
fn hard_killed_runtime_recovers_from_disk_and_restores_an_online_backup() {
    let root = tempfile::tempdir().unwrap();
    let data = root.path().join("data");
    let home = root.path().join("home");
    let repo = root.path().join("repo");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::create_dir_all(&repo).unwrap();
    repository(&repo);
    let data_dir = data.to_str().unwrap();

    let runtime = Runtime::start(&data, &home);
    let (status, view) = runtime.request(
        "POST",
        "/api/v1/projects",
        Some(json!({"id": "fixture", "name": "Fixture",
            "repositories": [{"id": "app", "path": repo.to_string_lossy()}]})),
    );
    assert_eq!(status, 201, "{view}");
    confirm(&runtime, 0, "import time; time.sleep(300)");
    let interrupted = start_baseline(&runtime);
    let deadline = Instant::now() + Duration::from_secs(60);
    let pid = loop {
        if let Some(spawned) = runtime
            .events(&interrupted)
            .into_iter()
            .find(|event| event["type"] == "check.spawned")
        {
            break spawned["payload"]["pid"].as_i64().unwrap() as i32;
        }
        assert!(Instant::now() < deadline, "check never started");
        std::thread::sleep(Duration::from_millis(25));
    };
    let _orphan = Orphan(pid);

    // Online backup while the check runs; restore needs the runtime stopped.
    let snapshot = root.path().join("snapshot.sqlite3");
    let backup = admin(&[
        "backup",
        "--data-dir",
        data_dir,
        "--output",
        snapshot.to_str().unwrap(),
    ]);
    let printed = String::from_utf8_lossy(&backup.stdout);
    assert!(
        backup.status.success(),
        "{printed}{}",
        String::from_utf8_lossy(&backup.stderr)
    );
    assert!(printed.contains(&format!(
        "schema_version: {}",
        luuna_storage::DATABASE_SCHEMA_VERSION
    )));
    assert!(printed.contains("sha256: "), "{printed}");
    let refused = admin(&[
        "restore",
        "--data-dir",
        data_dir,
        "--input",
        snapshot.to_str().unwrap(),
    ]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("owns"));

    // SIGKILL: no shutdown path, no supervisor, nothing settled in process.
    drop(runtime);
    let check = admin(&["check", "--data-dir", data_dir]);
    assert!(check.status.success(), "{check:?}");
    assert!(String::from_utf8_lossy(&check.stdout).contains("integrity: ok"));

    let runtime = Runtime::start(&data, &home);
    let record = runtime.terminal(&interrupted);
    assert_eq!(record["state"], "interrupted", "{record}");
    assert!(runtime.events(&interrupted).iter().any(|event| {
        event["type"] == "run.interrupted"
            && event["payload"]["reason"] == "runtime restarted before attempt settled"
    }));
    let (_, baselines) = runtime.request("GET", "/api/v1/projects/fixture/baselines", None);
    assert_eq!(baselines[0]["status"], "interrupted", "{baselines}");
    // Recovery leaves nothing wedged: the next baseline runs to a verdict.
    confirm(&runtime, 1, "print('running 1 tests')");
    let passed = start_baseline(&runtime);
    assert_eq!(runtime.terminal(&passed)["state"], "completed");
    let (_, baselines) = runtime.request("GET", "/api/v1/projects/fixture/baselines", None);
    assert_eq!(baselines[0]["status"], "passed", "{baselines}");
    runtime.shutdown();

    // Restore the snapshot taken mid-check; the later revision and run vanish.
    let restore = admin(&[
        "restore",
        "--data-dir",
        data_dir,
        "--input",
        snapshot.to_str().unwrap(),
    ]);
    let printed = String::from_utf8_lossy(&restore.stdout);
    assert!(
        restore.status.success(),
        "{printed}{}",
        String::from_utf8_lossy(&restore.stderr)
    );
    assert!(printed.contains("previous database moved to:"), "{printed}");
    let runtime = Runtime::start(&data, &home);
    let (status, _) = runtime.request("GET", &format!("/api/v1/runs/{passed}"), None);
    assert_eq!(status, 404);
    let record = runtime.terminal(&interrupted);
    assert_eq!(record["state"], "interrupted", "{record}");
    let (_, project) = runtime.request("GET", "/api/v1/projects/fixture", None);
    assert_eq!(project["project"]["revision"], 1, "{project}");
    runtime.shutdown();
}
