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
use std::io::{self, Stdout};

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
