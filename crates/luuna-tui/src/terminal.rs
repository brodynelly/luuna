use crossterm::{
    cursor::{Hide, Show},
    event::{DisableBracketedPaste, EnableBracketedPaste},
    execute, queue,
    terminal::{
        disable_raw_mode, enable_raw_mode, is_raw_mode_enabled, BeginSynchronizedUpdate,
        EndSynchronizedUpdate, EnterAlternateScreen, LeaveAlternateScreen,
    },
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::{
    cell::Cell,
    io::{self, Stdout, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

/// Graceful process-control requests share the normal keyboard cleanup path.
/// The launcher writes an empty marker; it never injects terminal input or kills
/// the native process to simulate a Windows SIGTERM.
pub struct Shutdown {
    marker: Option<PathBuf>,
    requested: Arc<AtomicBool>,
    signal_task: tokio::task::JoinHandle<()>,
}

impl Shutdown {
    pub fn install() -> io::Result<Self> {
        let requested = Arc::new(AtomicBool::new(false));
        let signal_requested = requested.clone();
        #[cfg(unix)]
        let signal_task = {
            use tokio::signal::unix::{signal, SignalKind};
            let mut interrupt = signal(SignalKind::interrupt())?;
            let mut terminate = signal(SignalKind::terminate())?;
            let mut hangup = signal(SignalKind::hangup())?;
            tokio::spawn(async move {
                tokio::select! {
                    _ = interrupt.recv() => {},
                    _ = terminate.recv() => {},
                    _ = hangup.recv() => {},
                }
                signal_requested.store(true, Ordering::Release);
            })
        };
        #[cfg(windows)]
        let signal_task = {
            use tokio::signal::windows;
            let mut interrupt = windows::ctrl_c()?;
            let mut break_signal = windows::ctrl_break()?;
            let mut close = windows::ctrl_close()?;
            let mut logoff = windows::ctrl_logoff()?;
            let mut shutdown = windows::ctrl_shutdown()?;
            tokio::spawn(async move {
                tokio::select! {
                    _ = interrupt.recv() => {},
                    _ = break_signal.recv() => {},
                    _ = close.recv() => {},
                    _ = logoff.recv() => {},
                    _ = shutdown.recv() => {},
                }
                signal_requested.store(true, Ordering::Release);
            })
        };
        Ok(Self {
            marker: std::env::var_os("LUUNA_TUI_SHUTDOWN_FILE").map(PathBuf::from),
            requested,
            signal_task,
        })
    }

    pub fn requested(&self) -> bool {
        self.requested.load(Ordering::Acquire)
            || self.marker.as_ref().is_some_and(|path| {
                path.try_exists().unwrap_or(true)
                    || path
                        .parent()
                        .is_none_or(|parent| !parent.try_exists().unwrap_or(false))
            })
    }
}

impl Drop for Shutdown {
    fn drop(&mut self) {
        self.signal_task.abort();
    }
}

thread_local! {
    /// True between `BeginSynchronizedUpdate` and its matching End on this thread, so
    /// restoration paths (guard drop, panic hook) can close an open update. The flag is
    /// thread-local: the panic hook only sees it when the panic occurs on the thread that
    /// drew (the main thread); panics on other threads cannot close the update.
    static SYNC_OPEN: Cell<bool> = const { Cell::new(false) };
}

/// Draw one frame, wrapped in DEC 2026 synchronized output when `sync` is set. The End
/// sequence is always attempted, including when the draw fails.
pub fn draw_frame<W: Write>(
    terminal: &mut Terminal<CrosstermBackend<W>>,
    sync: bool,
    render: impl FnOnce(&mut ratatui::Frame),
) -> io::Result<()> {
    if sync {
        queue!(terminal.backend_mut(), BeginSynchronizedUpdate)?;
        SYNC_OPEN.with(|open| open.set(true));
    }
    let drawn = terminal.draw(render).map(|_| ());
    if !sync {
        return drawn;
    }
    let ended = execute!(terminal.backend_mut(), EndSynchronizedUpdate);
    SYNC_OPEN.with(|open| open.set(false));
    drawn.and(ended)
}

/// Close a synchronized update left open by a panic or early exit; no-op otherwise.
fn close_sync<W: Write>(writer: &mut W) {
    if SYNC_OPEN.with(|open| open.replace(false)) {
        let _ = execute!(writer, EndSynchronizedUpdate);
    }
}

pub type Screen = Terminal<CrosstermBackend<Stdout>>;
pub struct TerminalGuard {
    previous_raw: bool,
}

impl TerminalGuard {
    pub fn enter() -> io::Result<Self> {
        let guard = Self {
            previous_raw: is_raw_mode_enabled()?,
        };
        enable_raw_mode()?;
        if let Err(error) = execute!(
            io::stdout(),
            EnterAlternateScreen,
            EnableBracketedPaste,
            Hide
        ) {
            drop(guard);
            return Err(error);
        }
        Ok(guard)
    }
    pub fn screen(&self) -> io::Result<Screen> {
        Terminal::new(CrosstermBackend::new(io::stdout()))
    }
}
impl Drop for TerminalGuard {
    fn drop(&mut self) {
        close_sync(&mut io::stdout());
        let _ = execute!(
            io::stdout(),
            DisableBracketedPaste,
            Show,
            LeaveAlternateScreen
        );
        if !self.previous_raw {
            let _ = disable_raw_mode();
        }
    }
}

/// Restore before panic diagnostics; the guard also restores normally and during unwind.
pub fn install_panic_restore() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        close_sync(&mut io::stdout());
        let _ = execute!(
            io::stdout(),
            DisableBracketedPaste,
            Show,
            LeaveAlternateScreen
        );
        let _ = disable_raw_mode();
        previous(info);
    }));
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{layout::Rect, widgets::Paragraph, TerminalOptions, Viewport};
    use std::{cell::RefCell, rc::Rc};

    const BEGIN: &str = "[?2026h";
    const END: &str = "[?2026l";

    #[derive(Clone, Default)]
    struct Capture {
        bytes: Rc<RefCell<Vec<u8>>>,
        fail: Rc<Cell<bool>>,
    }
    impl Write for Capture {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            if self.fail.replace(false) {
                return Err(io::Error::other("injected write failure"));
            }
            self.bytes.borrow_mut().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }
    impl Capture {
        fn text(&self) -> String {
            String::from_utf8_lossy(&self.bytes.borrow()).into_owned()
        }
    }

    fn terminal(writer: Capture) -> Terminal<CrosstermBackend<Capture>> {
        Terminal::with_options(
            CrosstermBackend::new(writer),
            TerminalOptions {
                viewport: Viewport::Fixed(Rect::new(0, 0, 12, 3)),
            },
        )
        .unwrap()
    }

    #[test]
    fn synchronized_draw_brackets_output() {
        let capture = Capture::default();
        let mut term = terminal(capture.clone());
        draw_frame(&mut term, true, |f| {
            f.render_widget(Paragraph::new("frame-pacing"), f.area())
        })
        .unwrap();
        let text = capture.text();
        assert_eq!(text.matches(BEGIN).count(), 1);
        assert_eq!(text.matches(END).count(), 1);
        let (begin, end) = (text.find(BEGIN).unwrap(), text.find(END).unwrap());
        assert!(begin < end);
        assert!(text[begin..end].contains("frame-pacing"));
        assert!(!SYNC_OPEN.with(Cell::get));
    }

    #[test]
    fn sync_opt_out_emits_no_2026() {
        let capture = Capture::default();
        let mut term = terminal(capture.clone());
        draw_frame(&mut term, false, |f| {
            f.render_widget(Paragraph::new("frame-pacing"), f.area())
        })
        .unwrap();
        let text = capture.text();
        assert!(!text.contains("?2026"));
        assert!(text.contains("frame-pacing"));
    }

    #[test]
    fn end_is_emitted_when_draw_fails() {
        let capture = Capture::default();
        let fail = capture.fail.clone();
        let mut term = terminal(capture.clone());
        let result = draw_frame(&mut term, true, |f| {
            f.render_widget(Paragraph::new("frame-pacing"), f.area());
            fail.set(true);
        });
        assert!(result.is_err());
        assert!(capture.text().ends_with(END));
        assert!(!SYNC_OPEN.with(Cell::get));
    }

    #[test]
    fn close_sync_writes_only_when_open() {
        let mut out = Vec::new();
        close_sync(&mut out);
        assert!(out.is_empty());
        SYNC_OPEN.with(|open| open.set(true));
        close_sync(&mut out);
        assert_eq!(String::from_utf8(out.clone()).unwrap(), END);
        close_sync(&mut out);
        assert_eq!(out.len(), END.len());
        assert!(!SYNC_OPEN.with(Cell::get));
    }

    #[test]
    fn panic_in_render_leaves_sync_open_so_close_sync_emits_end() {
        let capture = Capture::default();
        let mut term = terminal(capture.clone());
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = draw_frame(&mut term, true, |_| panic!("render panic"));
        }));
        assert!(result.is_err());
        assert!(SYNC_OPEN.with(Cell::get));
        let mut out = Vec::new();
        close_sync(&mut out);
        assert_eq!(String::from_utf8(out).unwrap(), END);
        assert!(!SYNC_OPEN.with(Cell::get));
    }
}
