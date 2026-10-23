//! The runtime client (formerly `LuunaClient` in packages/api-client): the loopback URL check,
//! bearer-token requests over plain HTTP/1.1 (the runtime only listens on loopback, ADR 0011), the
//! refusal mapping that never surfaces a server body, and the SSE follower with `Last-Event-ID`
//! resumption. Every method validates what the original validated before anything is sent.
use crate::failures::Failure;
use crate::js::{self, safe_integer, J};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::sync::watch;

pub const MAX_PAGE: f64 = 10_000.0;
pub const MAX_REASON_LENGTH: usize = 1000;

/// An abort signal: `abort()` on the controller ends every request waiting on it.
#[derive(Clone)]
pub struct Signal(watch::Receiver<bool>);

pub struct Controller(watch::Sender<bool>);

impl Controller {
    pub fn new() -> (Controller, Signal) {
        let (sender, receiver) = watch::channel(false);
        (Controller(sender), Signal(receiver))
    }
    pub fn abort(&self) {
        let _ = self.0.send(true);
    }
    pub fn signal(&self) -> Signal {
        Signal(self.0.subscribe())
    }
}

impl Default for Controller {
    fn default() -> Self {
        Controller::new().0
    }
}

impl Signal {
    /// A signal that is never aborted.
    pub fn never() -> Signal {
        let (sender, receiver) = watch::channel(false);
        std::mem::forget(sender);
        Signal(receiver)
    }
    pub fn aborted(&self) -> bool {
        *self.0.borrow()
    }
    /// Resolves once aborted (never resolves for a live, never-aborted signal).
    pub async fn wait(&self) {
        let mut receiver = self.0.clone();
        while !*receiver.borrow_and_update() {
            if receiver.changed().await.is_err() {
                std::future::pending::<()>().await;
            }
        }
    }
    /// Runs `work`, failing with `Aborted` when the signal fires first.
    pub async fn race<T>(
        &self,
        work: impl std::future::Future<Output = Result<T, Failure>>,
    ) -> Result<T, Failure> {
        if self.aborted() {
            return Err(Failure::Aborted);
        }
        tokio::select! {
            biased;
            _ = self.wait() => Err(Failure::Aborted),
            result = work => result,
        }
    }
    /// `pause(ms, signal)`: rejects when aborted.
    pub async fn sleep(&self, milliseconds: u64) -> Result<(), Failure> {
        self.race(async {
            tokio::time::sleep(Duration::from_millis(milliseconds)).await;
            Ok(())
        })
        .await
    }
}

/// `encodeURIComponent`.
pub fn encode_component(text: &str) -> String {
    let mut out = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// `URLSearchParams` serialization (application/x-www-form-urlencoded).
pub fn form_encode(pairs: &[(&str, &str)]) -> String {
    let encode = |text: &str| {
        let mut out = String::new();
        for byte in text.bytes() {
            if byte.is_ascii_alphanumeric() || b"*-._".contains(&byte) {
                out.push(byte as char);
            } else if byte == b' ' {
                out.push('+');
            } else {
                out.push_str(&format!("%{byte:02X}"));
            }
        }
        out
    };
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", encode(k), encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

/// The parts of a WHATWG URL the loopback check reads.
#[derive(Debug, PartialEq)]
struct Url {
    scheme: String,
    userinfo: bool,
    host: String,
    port: Option<u16>,
    path: String,
    query: Option<String>,
    fragment: Option<String>,
}

fn parse_ipv4_part(part: &str) -> Option<u64> {
    if part.is_empty() {
        return None;
    }
    let (digits, radix) =
        if let Some(hex) = part.strip_prefix("0x").or_else(|| part.strip_prefix("0X")) {
            (hex, 16)
        } else if part.len() > 1 && part.starts_with('0') {
            (&part[1..], 8)
        } else {
            (part, 10)
        };
    if digits.is_empty() {
        return Some(0);
    }
    u64::from_str_radix(digits, radix).ok()
}

/// The WHATWG host serialization for a special URL, or None when the host is invalid.
fn parse_host(raw: &str) -> Option<String> {
    if raw.starts_with('[') {
        let inner = raw.strip_prefix('[')?.strip_suffix(']')?;
        let address: std::net::Ipv6Addr = inner.parse().ok()?;
        return Some(format!("[{address}]"));
    }
    let decoded = percent_decode(raw)?.to_lowercase();
    if decoded.is_empty()
        || decoded
            .chars()
            .any(|c| " #%/:<>?@[\\]^|".contains(c) || c.is_control())
    {
        return None;
    }
    let mut parts: Vec<&str> = decoded.split('.').collect();
    if parts.last() == Some(&"") && parts.len() > 1 {
        parts.pop();
    }
    let last_numeric = parts
        .last()
        .is_some_and(|p| parse_ipv4_part(p).is_some() || p.chars().all(|c| c.is_ascii_digit()));
    if !last_numeric {
        return Some(decoded);
    }
    if parts.len() > 4 {
        return None;
    }
    let numbers: Option<Vec<u64>> = parts.iter().map(|p| parse_ipv4_part(p)).collect();
    let numbers = numbers?;
    let (init, last) = numbers.split_at(numbers.len() - 1);
    if init.iter().any(|n| *n > 255) || last[0] >= 256u64.pow(5 - numbers.len() as u32) {
        return None;
    }
    let mut value = last[0];
    for (index, n) in init.iter().enumerate() {
        value += n * 256u64.pow(3 - index as u32);
    }
    Some(std::net::Ipv4Addr::from(value as u32).to_string())
}

fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        if bytes[at] == b'%' && at + 2 < bytes.len() {
            if let Ok(byte) =
                u8::from_str_radix(std::str::from_utf8(&bytes[at + 1..at + 3]).ok()?, 16)
            {
                out.push(byte);
                at += 3;
                continue;
            }
        }
        out.push(bytes[at]);
        at += 1;
    }
    String::from_utf8(out).ok()
}

/// Parses an absolute URL far enough to answer the loopback check; None is `TypeError: Invalid URL`.
fn parse_url(input: &str) -> Option<Url> {
    let trimmed: String = input
        .trim_matches(|c: char| (c as u32) <= 0x20)
        .chars()
        .filter(|c| !matches!(c, '\t' | '\n' | '\r'))
        .collect();
    let colon = trimmed.find(':')?;
    let scheme = trimmed[..colon].to_ascii_lowercase();
    if scheme.is_empty()
        || !scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        || !scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c))
    {
        return None;
    }
    let rest = trimmed[colon + 1..].replace('\\', "/");
    let special = ["http", "https", "ws", "wss", "ftp", "file"].contains(&scheme.as_str());
    if !special {
        // A non-special absolute URL parses; its scheme alone fails the loopback check.
        return Some(Url {
            scheme,
            userinfo: false,
            host: String::new(),
            port: None,
            path: rest,
            query: None,
            fragment: None,
        });
    }
    let rest = rest.trim_start_matches('/');
    let (before_fragment, fragment) = match rest.split_once('#') {
        Some((a, b)) => (a.to_string(), Some(b.to_string())),
        None => (rest.to_string(), None),
    };
    let (before_query, query) = match before_fragment.split_once('?') {
        Some((a, b)) => (a.to_string(), Some(b.to_string())),
        None => (before_fragment.clone(), None),
    };
    let (authority, path) = match before_query.find('/') {
        Some(at) => (
            before_query[..at].to_string(),
            before_query[at..].to_string(),
        ),
        None => (before_query.clone(), "/".to_string()),
    };
    let (userinfo, hostport) = match authority.rfind('@') {
        Some(at) => (true, authority[at + 1..].to_string()),
        None => (false, authority.clone()),
    };
    let (host_raw, port_raw) = if hostport.starts_with('[') {
        let close = hostport.find(']')?;
        let after = &hostport[close + 1..];
        (
            hostport[..=close].to_string(),
            after.strip_prefix(':').map(str::to_string),
        )
    } else {
        match hostport.rfind(':') {
            Some(at) => (
                hostport[..at].to_string(),
                Some(hostport[at + 1..].to_string()),
            ),
            None => (hostport.clone(), None),
        }
    };
    let host = parse_host(&host_raw)?;
    let port = match port_raw.filter(|p| !p.is_empty()) {
        None => None,
        Some(p) => {
            if !p.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let value: u32 = p.trim_start_matches('0').parse().unwrap_or(0);
            if value > 65535 {
                return None;
            }
            let default = match scheme.as_str() {
                "http" | "ws" => 80,
                "https" | "wss" => 443,
                "ftp" => 21,
                _ => 0,
            };
            (value != default).then_some(value as u16)
        }
    };
    // Dot segments resolve away; the check only asks whether anything is left.
    let mut segments: Vec<&str> = Vec::new();
    let raw_segments: Vec<&str> = path.split('/').skip(1).collect();
    for (index, segment) in raw_segments.iter().enumerate() {
        let last = index + 1 == raw_segments.len();
        match segment.to_ascii_lowercase().as_str() {
            "." | "%2e" => {
                if last {
                    segments.push("");
                }
            }
            ".." | ".%2e" | "%2e." | "%2e%2e" => {
                segments.pop();
                if last {
                    segments.push("");
                }
            }
            _ => segments.push(segment),
        }
    }
    let path = format!("/{}", segments.join("/"));
    Some(Url {
        scheme,
        userinfo,
        host,
        port,
        path,
        query,
        fragment,
    })
}

/// Tokens may only be sent to the developer's local runtime: the URL's origin, or the failure the
/// original raised (`TypeError: Invalid URL` or the loopback refusal).
pub fn loopback_url(value: &str) -> Result<String, Failure> {
    let url = parse_url(value).ok_or_else(|| Failure::Type("Invalid URL".into()))?;
    if url.scheme != "http" || !["127.0.0.1", "localhost", "[::1]"].contains(&url.host.as_str()) {
        return Err(Failure::error(
            "Use an HTTP loopback runtime URL (127.0.0.1, localhost or [::1]).",
        ));
    }
    let nonempty = |part: &Option<String>| part.as_ref().is_some_and(|p| !p.is_empty());
    if url.userinfo || nonempty(&url.query) || nonempty(&url.fragment) || url.path != "/" {
        return Err(Failure::error(
            "Runtime URL must contain only a loopback address and optional port.",
        ));
    }
    Ok(format!(
        "http://{}{}",
        url.host,
        url.port.map(|p| format!(":{p}")).unwrap_or_default()
    ))
}

/// A run state the runtime will not leave by itself.
pub fn is_terminal(state: &str) -> bool {
    [
        "completed",
        "failed",
        "cancelled",
        "interrupted",
        "reviewed",
    ]
    .contains(&state)
}

/// One HTTP response: status, headers and the body as UTF-8 text.
struct Response {
    status: u16,
    body: String,
}

/// An open response whose body is read incrementally (the SSE stream).
struct Streaming {
    status: u16,
    reader: BufReader<TcpStream>,
    chunked: bool,
    remaining: Option<usize>,
    done: bool,
}

impl Streaming {
    /// The next piece of the body, or None at its end.
    async fn chunk(&mut self) -> Result<Option<Vec<u8>>, Failure> {
        if self.done {
            return Ok(None);
        }
        let transport = |_| Failure::Type("fetch failed".into());
        if self.chunked {
            let mut line = String::new();
            if self.reader.read_line(&mut line).await.map_err(transport)? == 0 {
                self.done = true;
                return Ok(None);
            }
            let size = usize::from_str_radix(line.trim().split(';').next().unwrap_or(""), 16)
                .map_err(|_| Failure::Type("fetch failed".into()))?;
            if size == 0 {
                self.done = true;
                return Ok(None);
            }
            let mut data = vec![0; size];
            self.reader.read_exact(&mut data).await.map_err(transport)?;
            let mut crlf = [0; 2];
            self.reader.read_exact(&mut crlf).await.map_err(transport)?;
            return Ok(Some(data));
        }
        let mut data = vec![0; 8192];
        let limit = self.remaining.map(|r| r.min(8192)).unwrap_or(8192);
        if limit == 0 {
            self.done = true;
            return Ok(None);
        }
        let read = self
            .reader
            .read(&mut data[..limit])
            .await
            .map_err(transport)?;
        if read == 0 {
            self.done = true;
            return Ok(None);
        }
        if let Some(remaining) = &mut self.remaining {
            *remaining -= read;
        }
        data.truncate(read);
        Ok(Some(data))
    }
    async fn text(mut self) -> Result<String, Failure> {
        let mut body = Vec::new();
        while let Some(chunk) = self.chunk().await? {
            body.extend(chunk);
        }
        Ok(String::from_utf8_lossy(&body).into_owned())
    }
}

#[derive(Clone)]
pub struct Client {
    pub base_url: String,
    token: String,
    /// Set before any non-GET request is sent (the bridge reports such an outcome as unknown).
    mutation: Option<std::sync::Arc<std::sync::atomic::AtomicBool>>,
    /// The bridge reports an unreadable successful response as `invalid_response`.
    bridge: bool,
}

impl Client {
    /// `new LuunaClient(url, token)`: the URL check first, then the token.
    pub fn new(base_url: &str, token: &str) -> Result<Client, Failure> {
        let base_url = loopback_url(base_url)?;
        if token.trim().is_empty() {
            return Err(Failure::error("Enter the local service token."));
        }
        Ok(Client {
            base_url,
            token: token.to_string(),
            mutation: None,
            bridge: false,
        })
    }

    /// The bridge's client: mutations are recorded in `flag`, unreadable responses are refusals.
    pub fn for_bridge(mut self, flag: std::sync::Arc<std::sync::atomic::AtomicBool>) -> Client {
        self.mutation = Some(flag);
        self.bridge = true;
        self
    }

    async fn open(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        accept: &str,
        extra: &[(&str, String)],
    ) -> Result<Streaming, Failure> {
        let rest = self
            .base_url
            .strip_prefix("http://")
            .unwrap_or(&self.base_url);
        let (connect_host, port) = match rest.strip_prefix('[') {
            Some(v6) => {
                let (address, after) = v6.split_once(']').unwrap_or((v6, ""));
                (
                    address.to_string(),
                    after
                        .strip_prefix(':')
                        .and_then(|p| p.parse().ok())
                        .unwrap_or(80u16),
                )
            }
            None => match rest.split_once(':') {
                Some((host, port)) => (host.to_string(), port.parse().unwrap_or(80u16)),
                None => (rest.to_string(), 80),
            },
        };
        let transport = |_| Failure::Type("fetch failed".into());
        let stream = TcpStream::connect((connect_host.as_str(), port))
            .await
            .map_err(transport)?;
        let mut request = format!("{method} {path} HTTP/1.1\r\nHost: {rest}\r\nAuthorization: Bearer {}\r\nAccept: {accept}\r\nConnection: close\r\n", self.token);
        for (name, value) in extra {
            request.push_str(&format!("{name}: {value}\r\n"));
        }
        match body {
            Some(body) => request.push_str(&format!(
                "Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
                body.len()
            )),
            None if method != "GET" => request.push_str("Content-Length: 0\r\n\r\n"),
            None => request.push_str("\r\n"),
        }
        let mut reader = BufReader::new(stream);
        reader
            .get_mut()
            .write_all(request.as_bytes())
            .await
            .map_err(transport)?;
        let mut status_line = String::new();
        if reader
            .read_line(&mut status_line)
            .await
            .map_err(transport)?
            == 0
        {
            return Err(Failure::Type("fetch failed".into()));
        }
        let status = status_line
            .split_whitespace()
            .nth(1)
            .and_then(|s| s.parse::<u16>().ok())
            .ok_or_else(|| Failure::Type("fetch failed".into()))?;
        let mut chunked = false;
        let mut length = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).await.map_err(transport)? == 0 {
                break;
            }
            let line = line.trim_end();
            if line.is_empty() {
                break;
            }
            if let Some((name, value)) = line.split_once(':') {
                let name = name.trim().to_ascii_lowercase();
                let value = value.trim();
                if name == "transfer-encoding" && value.to_ascii_lowercase().contains("chunked") {
                    chunked = true;
                }
                if name == "content-length" {
                    length = value.parse::<usize>().ok();
                }
            }
        }
        // `redirect: "error"`: a redirect is a network error.
        if (300..400).contains(&status) {
            return Err(Failure::Type("fetch failed".into()));
        }
        Ok(Streaming {
            status,
            reader,
            chunked,
            remaining: if chunked { None } else { length },
            done: false,
        })
    }

    async fn fetch(
        &self,
        method: &str,
        path: &str,
        body: Option<&str>,
        accept: &str,
        extra: &[(&str, String)],
    ) -> Result<Response, Failure> {
        let streaming = self.open(method, path, body, accept, extra).await?;
        let status = streaming.status;
        let body = streaming.text().await?;
        Ok(Response { status, body })
    }

    /// One JSON request under `/api/v1`; a failed status becomes the refusal it describes.
    pub async fn request(
        &self,
        method: &str,
        path: &str,
        body: Option<&J>,
        signal: &Signal,
    ) -> Result<J, Failure> {
        let text = body.and_then(J::stringify);
        if method != "GET" {
            if let Some(flag) = &self.mutation {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        signal
            .race(async {
                let response = self.fetch(method, &format!("/api/v1{path}"), text.as_deref(), "application/json", &[]).await?;
                if !(200..300).contains(&response.status) {
                    return Err(failure_of(response.status, &response.body));
                }
                js::parse(&response.body).map_err(|error| {
                    if self.bridge {
                        Failure::Protocol { code: "invalid_response".into(), message: "The runtime returned an unreadable response. Inspect authoritative state before repeating an action.".into() }
                    } else {
                        Failure::Error(error.0)
                    }
                })
            })
            .await
    }

    pub async fn get(&self, path: &str, signal: &Signal) -> Result<J, Failure> {
        self.request("GET", path, None, signal).await
    }
    pub async fn post(&self, path: &str, body: Option<&J>, signal: &Signal) -> Result<J, Failure> {
        self.request("POST", path, body, signal).await
    }

    /// A private check log by record identity.
    pub async fn artifact(&self, run: &str, artifact: &str, signal: &Signal) -> Result<J, Failure> {
        // /^[A-Za-z0-9._-]+\.(stdout|stderr)$/ and no ".."
        let stem = artifact
            .strip_suffix(".stdout")
            .or_else(|| artifact.strip_suffix(".stderr"));
        let valid = stem.is_some_and(|stem| {
            !stem.is_empty()
                && stem
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        }) && !artifact.contains("..");
        if !valid {
            return Err(Failure::error("Invalid artifact identifier."));
        }
        signal
            .race(async {
                let response = self
                    .fetch(
                        "GET",
                        &format!(
                            "/api/v1/runs/{}/artifacts/{}",
                            encode_component(run),
                            encode_component(artifact)
                        ),
                        None,
                        "text/plain",
                        &[],
                    )
                    .await?;
                if !(200..300).contains(&response.status) {
                    let message = if response.status == 404 {
                        "The artifact is not available.".to_string()
                    } else {
                        format!("Runtime request failed (HTTP {}).", response.status)
                    };
                    return Err(Failure::Api {
                        status: response.status,
                        message,
                        from_runtime: false,
                        prerequisite: None,
                    });
                }
                Ok(J::Str(response.body))
            })
            .await
    }

    /// One SSE connection to a run's event stream, resumed after `after`; `each` receives every
    /// event in order. Returns when the runtime closes the stream; transport failures are errors.
    pub async fn stream_events(
        &self,
        id: &str,
        after: f64,
        signal: &Signal,
        each: &mut (dyn FnMut(J) + Send),
    ) -> Result<(), Failure> {
        if !safe_integer(after) || after < 0.0 {
            return Err(Failure::error("Invalid event cursor."));
        }
        let mut cursor = after;
        let id = id.to_string();
        signal
            .race(async {
                let extra = if after > 0.0 { vec![("Last-Event-ID", js::number_to_string(after))] } else { Vec::new() };
                let mut streaming = self.open("GET", &format!("/api/v1/runs/{}/stream?after={}", encode_component(&id), js::number_to_string(after)), None, "text/event-stream", &extra).await?;
                if !(200..300).contains(&streaming.status) {
                    let status = streaming.status;
                    let body = streaming.text().await?;
                    return Err(failure_of(status, &body));
                }
                let mut buffered = String::new();
                let mut pending: Vec<u8> = Vec::new();
                let (mut event, mut data, mut lines) = (String::new(), String::new(), Vec::<String>::new());
                let _ = &mut data;
                loop {
                    let chunk = streaming.chunk().await?;
                    let done = chunk.is_none();
                    if let Some(bytes) = chunk {
                        pending.extend(bytes);
                        // Decode complete UTF-8 only, keeping a split character for the next chunk.
                        let valid = match std::str::from_utf8(&pending) {
                            Ok(_) => pending.len(),
                            Err(error) => error.valid_up_to(),
                        };
                        buffered.push_str(&String::from_utf8_lossy(&pending[..valid]));
                        pending.drain(..valid);
                    } else if !pending.is_empty() {
                        buffered.push_str(&String::from_utf8_lossy(&pending));
                        pending.clear();
                    }
                    let normalized = buffered.replace("\r\n", "\n").replace('\r', "\n");
                    let mut parts: Vec<String> = normalized.split('\n').map(str::to_string).collect();
                    buffered = if done { String::new() } else { parts.pop().unwrap_or_default() };
                    for line in parts {
                        if line.is_empty() {
                            if !lines.is_empty() {
                                let frame_data = lines.join("\n");
                                if event == "run_event" && !frame_data.is_empty() {
                                    let record = js::parse(&frame_data).map_err(|error| Failure::Error(error.0))?;
                                    let sequence = record.get("sequence").as_f64();
                                    let valid = record.get("event_id").truthy() && record.get("run_id").as_str() == Some(id.as_str()) && sequence.is_some_and(|s| safe_integer(s) && s > cursor);
                                    if !valid {
                                        return Err(Failure::error("Runtime returned an event for a different run or out of sequence."));
                                    }
                                    cursor = sequence.unwrap();
                                    each(record);
                                }
                            }
                            event.clear();
                            lines.clear();
                            continue;
                        }
                        if line.starts_with(':') {
                            continue;
                        }
                        let (field, value) = match line.find(':') {
                            Some(at) => (&line[..at], line[at + 1..].strip_prefix(' ').unwrap_or(&line[at + 1..])),
                            None => (line.as_str(), ""),
                        };
                        match field {
                            "event" => event = value.to_string(),
                            "data" => lines.push(value.to_string()),
                            _ => {}
                        }
                    }
                    if done {
                        return Ok(());
                    }
                }
            })
            .await
    }

    /// Follows a run's events live until it settles, reconnecting after an outage from the last
    /// received sequence. A rejected token, a denied action or a forgotten run end the follow.
    pub async fn follow_events(
        &self,
        id: &str,
        after: f64,
        signal: &Signal,
        each: &mut (dyn FnMut(J) + Send),
        outage: &mut (dyn FnMut(&Failure, f64) + Send),
        reconnected: &mut (dyn FnMut(f64) + Send),
    ) -> Result<(), Failure> {
        let mut cursor = after;
        let mut lost = false;
        while !signal.aborted() {
            let attempt: Result<bool, Failure> = async {
                let mut seen = cursor;
                let mut was_lost = lost;
                let result = self
                    .stream_events(id, cursor, signal, &mut |event| {
                        if was_lost {
                            was_lost = false;
                            reconnected(seen);
                        }
                        seen = event.get("sequence").as_f64().unwrap_or(seen);
                        each(event);
                    })
                    .await;
                lost = was_lost;
                cursor = seen;
                result?;
                let run = self
                    .get(&format!("/runs/{}", encode_component(id)), signal)
                    .await?;
                if lost {
                    lost = false;
                    reconnected(cursor);
                }
                if is_terminal(&run.get("state").js()) {
                    return Ok(true);
                }
                signal.sleep(1000).await?;
                Ok(false)
            }
            .await;
            match attempt {
                Ok(true) => return Ok(()),
                Ok(false) => {}
                Err(failure) => {
                    if signal.aborted() {
                        return Ok(());
                    }
                    if let Failure::Api {
                        status: 401 | 403 | 404,
                        ..
                    } = failure
                    {
                        return Err(failure);
                    }
                    lost = true;
                    outage(&failure, cursor);
                    let _ = signal.sleep(2500).await;
                }
            }
        }
        Ok(())
    }
}

/// The failure a non-2xx response stands for; only a short deterministic `{error}` reason passes.
fn failure_of(status: u16, body: &str) -> Failure {
    let message = match status {
        400 => "The runtime rejected these settings. Check the prompt, provider and model configuration.".to_string(),
        401 => "The service rejected this token. Reconnect using its current token.".to_string(),
        403 => "The runtime denied this action.".to_string(),
        409 => "The run state changed or another session is active. Refresh and try again.".to_string(),
        _ => format!("Runtime request failed (HTTP {status})."),
    };
    let refusal = if [400, 409, 413, 415, 422, 503].contains(&status) {
        runtime_refusal(body)
    } else {
        None
    };
    match refusal {
        Some((reason, prerequisite)) => Failure::Api {
            status,
            message: reason,
            from_runtime: true,
            prerequisite,
        },
        None => Failure::Api {
            status,
            message,
            from_runtime: false,
            prerequisite: None,
        },
    }
}

fn has_control(text: &str) -> bool {
    text.chars().any(|c| (c as u32) < 0x20)
}

fn runtime_refusal(body: &str) -> Option<(String, Option<J>)> {
    let value = js::parse(body).ok()?;
    let reason = value
        .get("error")
        .as_str()?
        .trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
        .to_string();
    if reason.is_empty() || js::len16(&reason) > MAX_REASON_LENGTH || has_control(&reason) {
        return None;
    }
    let prerequisite = if value.has("prerequisite") {
        testing_prerequisite(value.get("prerequisite"))
    } else {
        None
    };
    Some((reason, prerequisite))
}

fn testing_prerequisite(value: &J) -> Option<J> {
    if !value.is_obj() {
        return None;
    }
    let text = |field: &str| {
        value
            .get(field)
            .as_str()
            .is_some_and(|s| js::len16(s) <= 4000 && !has_control(s))
    };
    if value.get("kind").as_str() != Some("testing_setup")
        || ![
            "project_id",
            "repository_id",
            "baseline_id",
            "reason",
            "next",
        ]
        .iter()
        .all(|f| text(f))
    {
        return None;
    }
    let mut offer = J::obj();
    offer.set("kind", J::str("testing_setup"));
    for field in [
        "project_id",
        "repository_id",
        "baseline_id",
        "reason",
        "next",
    ] {
        offer.set(field, value.get(field).clone());
    }
    Some(offer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_urls_follow_the_whatwg_parser() {
        assert_eq!(
            loopback_url("http://127.0.0.1:4242").unwrap(),
            "http://127.0.0.1:4242"
        );
        assert_eq!(
            loopback_url("http://LOCALHOST:80/").unwrap(),
            "http://localhost"
        );
        assert_eq!(loopback_url("http://[0:0::1]:9").unwrap(), "http://[::1]:9");
        assert_eq!(
            loopback_url("http://127.1:5").unwrap(),
            "http://127.0.0.1:5"
        );
        assert!(matches!(loopback_url("not a url"), Err(Failure::Type(_))));
        assert_eq!(
            loopback_url("http://example.com").unwrap_err().message(),
            "Use an HTTP loopback runtime URL (127.0.0.1, localhost or [::1])."
        );
        assert_eq!(
            loopback_url("https://127.0.0.1").unwrap_err().message(),
            "Use an HTTP loopback runtime URL (127.0.0.1, localhost or [::1])."
        );
        assert_eq!(
            loopback_url("http://127.0.0.1/x").unwrap_err().message(),
            "Runtime URL must contain only a loopback address and optional port."
        );
        assert_eq!(
            loopback_url("http://u@127.0.0.1").unwrap_err().message(),
            "Runtime URL must contain only a loopback address and optional port."
        );
        assert!(loopback_url("http://127.0.0.1/?").is_ok());
        assert_eq!(encode_component("a b/é"), "a%20b%2F%C3%A9");
        assert_eq!(
            form_encode(&[("limit", "200"), ("before", "a b")]),
            "limit=200&before=a+b"
        );
    }

    #[test]
    fn refusals_pass_only_short_runtime_reasons() {
        assert_eq!(
            failure_of(409, r#"{"error":" busy "}"#),
            Failure::Api {
                status: 409,
                message: "busy".into(),
                from_runtime: true,
                prerequisite: None
            }
        );
        assert_eq!(
            failure_of(500, r#"{"error":"secret"}"#).message(),
            "Runtime request failed (HTTP 500)."
        );
        assert_eq!(
            failure_of(401, "").message(),
            "The service rejected this token. Reconnect using its current token."
        );
        assert!(matches!(
            failure_of(422, "<html>"),
            Failure::Api {
                from_runtime: false,
                ..
            }
        ));
    }
}
