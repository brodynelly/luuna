//! A mock runtime for the client tests: a loopback HTTP/1.1 server that records every request and
//! answers from a handler. Nothing here touches a real runtime.
#![allow(dead_code)]
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::{Arc, Mutex};

#[derive(Clone, Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: Vec<(String, String)>,
    pub body: String,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }
    pub fn json(&self) -> serde_json::Value {
        serde_json::from_str(&self.body).unwrap_or(serde_json::Value::Null)
    }
}

pub struct Reply {
    pub status: u16,
    pub content_type: &'static str,
    pub body: String,
}

pub fn json(value: serde_json::Value) -> Reply {
    Reply {
        status: 200,
        content_type: "application/json",
        body: value.to_string(),
    }
}
pub fn status(status: u16, body: &str) -> Reply {
    Reply {
        status,
        content_type: "application/json",
        body: body.to_string(),
    }
}

pub struct Mock {
    pub port: u16,
    pub requests: Arc<Mutex<Vec<Request>>>,
}

impl Mock {
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
    pub fn take(&self) -> Vec<Request> {
        std::mem::take(&mut *self.requests.lock().unwrap())
    }
}

/// Starts a server on a free port; `handler` answers every request.
pub fn serve(handler: impl Fn(&Request) -> Reply + Send + Sync + 'static) -> Mock {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = listener.local_addr().unwrap().port();
    let requests = Arc::new(Mutex::new(Vec::new()));
    let recorded = requests.clone();
    let handler = Arc::new(handler);
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { continue };
            let handler = handler.clone();
            let recorded = recorded.clone();
            std::thread::spawn(move || {
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    return;
                }
                let mut parts = line.split_whitespace();
                let method = parts.next().unwrap_or("").to_string();
                let target = parts.next().unwrap_or("").to_string();
                let (path, query) = target
                    .split_once('?')
                    .map(|(p, q)| (p.to_string(), q.to_string()))
                    .unwrap_or((target.clone(), String::new()));
                let mut headers = Vec::new();
                loop {
                    let mut header = String::new();
                    if reader.read_line(&mut header).unwrap_or(0) == 0 || header.trim().is_empty() {
                        break;
                    }
                    if let Some((k, v)) = header.trim_end().split_once(':') {
                        headers.push((k.trim().to_string(), v.trim().to_string()));
                    }
                }
                let length = headers
                    .iter()
                    .find(|(k, _)| k.eq_ignore_ascii_case("content-length"))
                    .and_then(|(_, v)| v.parse().ok())
                    .unwrap_or(0);
                let mut body = vec![0; length];
                let _ = reader.read_exact(&mut body);
                let request = Request {
                    method,
                    path,
                    query,
                    headers,
                    body: String::from_utf8_lossy(&body).into_owned(),
                };
                recorded.lock().unwrap().push(request.clone());
                let reply = handler(&request);
                let _ = write!(stream, "HTTP/1.1 {} X\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", reply.status, reply.content_type, reply.body.len(), reply.body);
                let _ = stream.flush();
            });
        }
    });
    Mock { port, requests }
}

/// Runs the built client with `argv` against `url`; returns (exit code, stdout, stderr).
pub fn run_client(
    argv: &[&str],
    url: &str,
    token: Option<&str>,
    stdin: &str,
    cwd: &std::path::Path,
) -> (i32, String, String) {
    use std::process::{Command, Stdio};
    let mut command = Command::new(env!("CARGO_BIN_EXE_luuna-tui"));
    command
        .args(argv)
        .current_dir(cwd)
        .env_remove("LUUNA_CLI_NAME")
        .env("NO_COLOR", "1")
        .env("LUUNA_URL", url)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    match token {
        Some(token) => command.env("LUUNA_API_TOKEN", token),
        None => command.env_remove("LUUNA_API_TOKEN"),
    };
    let mut child = command.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).into_owned(),
        String::from_utf8_lossy(&output.stderr).into_owned(),
    )
}
