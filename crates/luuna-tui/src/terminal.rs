use crossterm::{
    cursor::{Hide, Show},
    event::{DisableBracketedPaste, EnableBracketedPaste},
    execute,
    terminal::{
        disable_raw_mode, enable_raw_mode, is_raw_mode_enabled, EnterAlternateScreen,
        LeaveAlternateScreen,
    },
};
use ratatui::{backend::CrosstermBackend, Terminal};
use std::{
    io::{self, Stdout},
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
