use crate::protocol::{BridgeEvent, ClientCommand, MAX_FRAME, QUEUE_SIZE};
use std::{
    io,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::mpsc,
    task::JoinHandle,
};

pub struct Bridge {
    child: Child,
    sender: Option<mpsc::Sender<Vec<u8>>>,
    receiver: mpsc::Receiver<Result<BridgeEvent, String>>,
    tasks: Vec<JoinHandle<()>>,
}

impl Bridge {
    pub fn spawn(node: &Path, script: &Path, token: &str, url: Option<&str>) -> io::Result<Self> {
        let mut command = Command::new(node);
        command
            .arg(script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        command.env("LUUNA_API_TOKEN", token);
        if let Some(url) = url {
            command.env("LUUNA_URL", url);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000); // Owned transport is never a separate console window.
        let mut child = command.spawn()?;
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| io::Error::other("Bridge stdin unavailable"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| io::Error::other("Bridge stdout unavailable"))?;
        let mut stderr = child
            .stderr
            .take()
            .ok_or_else(|| io::Error::other("Bridge stderr unavailable"))?;
        let (sender, mut requests) = mpsc::channel::<Vec<u8>>(QUEUE_SIZE);
        let (events, receiver) = mpsc::channel(QUEUE_SIZE);
        let writer_events = events.clone();
        let writer = tokio::spawn(async move {
            while let Some(bytes) = requests.recv().await {
                if stdin.write_all(&bytes).await.is_err() || stdin.flush().await.is_err() {
                    let _ = writer_events.send(Err("Bridge input closed; an in-flight mutation may have completed. Inspect runtime state before retrying.".into())).await;
                    break;
                }
            }
        });
        let secret = token.to_owned();
        let reader = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            loop {
                match read_frame(&mut reader).await {
                    Ok(Some(bytes)) => {
                        let mut decoded = BridgeEvent::decode(&bytes);
                        if let Ok(event) = &mut decoded {
                            // Defense in depth; bridge also redacts its known credential before writing.
                            if !secret.is_empty() {
                                for value in event.fields.values_mut() {
                                    redact(value, &secret);
                                }
                            }
                        }
                        let failed = decoded.is_err();
                        if events.send(decoded).await.is_err() || failed {
                            break;
                        }
                    }
                    Ok(None) => {
                        let _ = events.send(Err("Bridge exited. Inspect runtime state before retrying an in-flight mutation.".into())).await;
                        break;
                    }
                    Err(_) => {
                        let _ = events
                            .send(Err(
                                "Bridge protocol failed or exceeded its frame limit.".into()
                            ))
                            .await;
                        break;
                    }
                }
            }
        });
        let drain = tokio::spawn(async move {
            // Drain in fixed chunks; never surface untrusted Node stacks or credential-bearing stderr.
            let mut bytes = [0; 4096];
            while let Ok(count) = stderr.read(&mut bytes).await {
                if count == 0 {
                    break;
                }
            }
        });
        Ok(Self {
            child,
            sender: Some(sender),
            receiver,
            tasks: vec![writer, reader, drain],
        })
    }

    pub fn send(&self, request: &ClientCommand) -> Result<(), String> {
        let bytes = request.encode()?;
        self.sender
            .as_ref()
            .ok_or("Bridge is closed.")?
            .try_send(bytes)
            .map_err(|_| "Bridge input queue is full or closed; request was not sent.".into())
    }

    pub fn try_recv(&mut self) -> Option<Result<BridgeEvent, String>> {
        self.receiver.try_recv().ok()
    }
    pub async fn recv(&mut self) -> Option<Result<BridgeEvent, String>> {
        self.receiver.recv().await
    }
    pub fn process_id(&self) -> Option<u32> {
        self.child.id()
    }

    pub async fn shutdown(&mut self) {
        let _ = self.send(&ClientCommand::new(
            "shutdown",
            "shutdown",
            serde_json::json!({}),
        ));
        self.sender.take();
        if tokio::time::timeout(Duration::from_millis(750), self.child.wait())
            .await
            .is_err()
        {
            let _ = self.child.kill().await;
            let _ = self.child.wait().await;
        }
        for task in self.tasks.drain(..) {
            task.abort();
            let _ = task.await;
        }
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.sender.take();
        let _ = self.child.start_kill();
        for task in &self.tasks {
            task.abort();
        }
    }
}

fn redact(value: &mut serde_json::Value, secret: &str) {
    match value {
        serde_json::Value::String(text) => *text = text.replace(secret, "[redacted]"),
        serde_json::Value::Array(values) => values.iter_mut().for_each(|v| redact(v, secret)),
        serde_json::Value::Object(values) => values.values_mut().for_each(|v| redact(v, secret)),
        _ => {}
    }
}

/// Incremental byte reading bounds allocation even if a malicious peer never emits a newline.
pub async fn read_frame<R: AsyncRead + Unpin>(reader: &mut R) -> io::Result<Option<Vec<u8>>> {
    let mut frame = Vec::with_capacity(4096);
    loop {
        let mut byte = [0];
        if reader.read(&mut byte).await? == 0 {
            return if frame.is_empty() {
                Ok(None)
            } else {
                Err(io::Error::other("Incomplete bridge frame"))
            };
        }
        if byte[0] == b'\n' {
            return Ok(Some(frame));
        }
        if frame.len() == MAX_FRAME {
            return Err(io::Error::other("Oversized bridge frame"));
        }
        frame.push(byte[0]);
    }
}

pub fn default_bridge() -> PathBuf {
    // Checkout fallback is anchored to the compile-time manifest, never the invoking project's cwd.
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/tui/src/bridge.mjs")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn framing_is_bounded_and_rejects_truncated_jsonl() {
        let mut source = &b"one\ntwo\n"[..];
        assert_eq!(read_frame(&mut source).await.unwrap().unwrap(), b"one");
        assert_eq!(read_frame(&mut source).await.unwrap().unwrap(), b"two");
        assert!(read_frame(&mut source).await.unwrap().is_none());
        assert!(read_frame(&mut &b"truncated"[..]).await.is_err());
        assert!(read_frame(&mut &vec![b'x'; MAX_FRAME + 1][..])
            .await
            .is_err());
    }
}
