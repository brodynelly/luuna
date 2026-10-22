use ratatui::style::{Color, Modifier, Style};

#[derive(Clone, Copy)]
pub struct Theme {
    pub color: bool,
}
impl Theme {
    pub fn from_env() -> Self {
        Self {
            color: std::env::var("NO_COLOR").unwrap_or_default().is_empty()
                && std::env::var("TERM").unwrap_or_default() != "dumb",
        }
    }
    pub fn base(self) -> Style {
        self.style(Color::Rgb(200, 213, 225), Color::Rgb(12, 20, 44))
    }
    pub fn panel(self) -> Style {
        self.style(Color::Rgb(216, 226, 232), Color::Rgb(17, 31, 57))
    }
    pub fn accent(self) -> Style {
        self.style(Color::Rgb(90, 228, 213), Color::Rgb(17, 31, 57))
    }
    pub fn selected(self) -> Style {
        self.style(Color::Rgb(9, 25, 42), Color::Rgb(90, 228, 213))
            .add_modifier(Modifier::BOLD)
    }
    pub fn muted(self) -> Style {
        self.style(Color::Rgb(137, 155, 178), Color::Rgb(17, 31, 57))
    }
    pub fn tone(self, tone: &str) -> Style {
        let color = match tone {
            "success" => Color::Green,
            "active" => Color::Cyan,
            "danger" => Color::LightRed,
            "attention" => Color::Yellow,
            "interrupted" => Color::Magenta,
            _ => Color::Gray,
        };
        if self.color {
            self.panel().fg(color)
        } else {
            Style::default()
        }
    }
    fn style(self, foreground: Color, background: Color) -> Style {
        if self.color {
            Style::default().fg(foreground).bg(background)
        } else {
            Style::default()
        }
    }
}

pub fn state_tone(state: &str) -> &'static str {
    match state {
        "passed" | "accepted" | "connected" => "success",
        "running" | "implementing" | "validating" | "reviewing" => "active",
        "failed" | "rejected" => "danger",
        "blocked" | "pending" | "unconfirmed" | "approved" => "attention",
        "interrupted" | "reconnecting" | "offline" => "interrupted",
        _ => "neutral",
    }
}
