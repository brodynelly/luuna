//! Dedicated blocking terminal-input thread. It is the sole consumer of crossterm's
//! global event source. A thread was chosen over `EventStream` because that needs the
//! `event-stream` feature and a stream-extension dependency, which would change
//! `Cargo.lock`. Dropping `Input` stops and joins the thread so no input is consumed
//! after the terminal is restored.

use crossterm::event::{self, Event, KeyEventKind};
use std::{
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread::JoinHandle,
    time::Duration,
};
use tokio::sync::mpsc;

pub const INPUT_QUEUE: usize = 64;
/// Only bounds how quickly the thread notices the stop flag; input is delivered on arrival.
pub const INPUT_POLL: Duration = Duration::from_millis(50);

pub struct Input {
    receiver: mpsc::Receiver<io::Result<Event>>,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Input {
    pub fn spawn() -> io::Result<Self> {
        let (sender, receiver) = mpsc::channel(INPUT_QUEUE);
        let stop = Arc::new(AtomicBool::new(false));
        let flag = stop.clone();
        let thread = std::thread::Builder::new()
            .name("luuna-tui-input".into())
            .spawn(move || {
                while !flag.load(Ordering::Acquire) {
                    match event::poll(INPUT_POLL) {
                        Ok(true) => match event::read() {
                            Ok(event) => {
                                let wanted = match &event {
                                    Event::Key(key) => key.kind != KeyEventKind::Release,
                                    Event::Paste(_) | Event::Resize(..) => true,
                                    _ => false,
                                };
                                if wanted && sender.blocking_send(Ok(event)).is_err() {
                                    return;
                                }
                            }
                            Err(error) => {
                                let _ = sender.blocking_send(Err(error));
                                return;
                            }
                        },
                        Ok(false) => {}
                        Err(error) => {
                            let _ = sender.blocking_send(Err(error));
                            return;
                        }
                    }
                }
            })?;
        Ok(Self {
            receiver,
            stop,
            thread: Some(thread),
        })
    }

    pub async fn recv(&mut self) -> Option<io::Result<Event>> {
        self.receiver.recv().await
    }

    pub fn try_recv(&mut self) -> Option<io::Result<Event>> {
        self.receiver.try_recv().ok()
    }
}

impl Drop for Input {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        // Unblock a pending blocking_send, then wait for the thread to exit.
        self.receiver.close();
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}
