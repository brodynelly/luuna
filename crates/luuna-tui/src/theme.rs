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
        self.style(Color::Rgb(170, 170, 170), Color::Rgb(0, 0, 170))
    }
    pub fn panel(self) -> Style {
        self.style(Color::Rgb(255, 255, 255), Color::Rgb(0, 0, 170))
    }
    pub fn accent(self) -> Style {
        self.style(Color::Rgb(85, 255, 255), Color::Rgb(0, 0, 170))
    }
    pub fn selected(self) -> Style {
        self.style(Color::Rgb(255, 255, 255), Color::Rgb(0, 170, 0))
            .add_modifier(Modifier::BOLD)
    }
    pub fn muted(self) -> Style {
        self.base()
    }
    pub fn chrome(self) -> Style {
        self.style(Color::Black, Color::Rgb(170, 170, 170))
    }
    pub fn mnemonic(self) -> Style {
        self.style(Color::Rgb(170, 0, 0), Color::Rgb(170, 170, 170))
            .add_modifier(Modifier::BOLD)
    }
    pub fn title(self) -> Style {
        self.style(Color::Rgb(255, 255, 85), Color::Rgb(0, 0, 170))
            .add_modifier(Modifier::BOLD)
    }
    pub fn focused(self) -> Style {
        self.panel()
    }
    pub fn tone(self, tone: &str) -> Style {
        let color = match tone {
            "success" => Color::Rgb(85, 255, 85),
            "active" => Color::Rgb(85, 255, 255),
            "danger" => Color::Rgb(255, 85, 85),
            "attention" => Color::Rgb(255, 255, 85),
            "interrupted" => Color::Rgb(255, 85, 255),
            _ => Color::Rgb(170, 170, 170),
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
        "passed" | "accepted" | "connected" | "reviewed" => "success",
        "running" | "exploring" | "implementing" | "validating" | "reviewing" | "active" => {
            "active"
        }
        "failed" | "rejected" | "blocked" | "testing_blocked" | "changes_required" | "blocking" => {
            "danger"
        }
        "unconfirmed" | "approved" | "plan_ready" | "paused" | "warning" => "attention",
        "interrupted" | "reconnecting" | "abandoned" => "interrupted",
        _ => "neutral",
    }
}
