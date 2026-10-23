//! The terminal client's settings file: key bindings, colors and terminal options, in JSON.
//! It is read once when the workbench starts. A missing file means the defaults; a value
//! that cannot be used is reported in the status line and skipped, never fatal.
//!
//! Location, first match wins: `$LUUNA_TUI_CONFIG`; `$XDG_CONFIG_HOME/luuna/tui.json`;
//! `%APPDATA%\luuna\tui.json` on Windows; `~/.config/luuna/tui.json` elsewhere (macOS too).
use crate::keys::{self, Keymap};
use crate::theme::{self, Palette, ThemeConfig};
use serde::Deserialize;
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    /// Optional: lets editors validate the file. Ignored by the client.
    #[serde(rename = "$schema")]
    pub schema: Option<String>,
    /// Action name → every key that triggers it. A listed action's defaults are replaced.
    pub keys: BTreeMap<String, Vec<String>>,
    pub theme: ThemeConfig,
    /// Ask the terminal for unambiguous key reports (kitty protocol: kitty, WezTerm, Ghostty,
    /// foot, iTerm2 with CSI u). Lets Shift+Enter and Ctrl+Enter arrive. Defaults to true.
    pub keyboard_enhancement: Option<bool>,
}

#[derive(Clone)]
pub struct Loaded {
    pub path: Option<PathBuf>,
    pub found: bool,
    pub keyboard_enhancement: bool,
    pub warnings: Vec<String>,
}

pub fn path() -> Option<PathBuf> {
    let var = |name: &str| {
        std::env::var_os(name)
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    };
    if let Some(path) = var("LUUNA_TUI_CONFIG") {
        return Some(path);
    }
    if let Some(dir) = var("XDG_CONFIG_HOME") {
        return Some(dir.join("luuna").join("tui.json"));
    }
    if cfg!(windows) {
        if let Some(dir) = var("APPDATA") {
            return Some(dir.join("luuna").join("tui.json"));
        }
    }
    var("HOME")
        .or_else(|| var("USERPROFILE"))
        .map(|home| home.join(".config").join("luuna").join("tui.json"))
}

/// Parses a settings document; problems become warnings and the rest still applies.
pub fn parse(text: &str) -> (Config, Vec<String>) {
    match serde_json::from_str::<Config>(text) {
        Ok(config) => (config, Vec::new()),
        Err(error) => (
            Config::default(),
            vec![format!("settings ignored: {error}")],
        ),
    }
}

/// Reads the settings file and installs its keymap and palette for the whole process.
pub fn load_and_install() -> Loaded {
    let path = path();
    let mut warnings = Vec::new();
    let (config, found) = match path.as_ref().map(std::fs::read_to_string) {
        Some(Ok(text)) => {
            let (config, mut problems) = parse(&text);
            warnings.append(&mut problems);
            (config, true)
        }
        Some(Err(error)) if error.kind() != std::io::ErrorKind::NotFound => {
            warnings.push(format!("settings unreadable: {error}"));
            (Config::default(), false)
        }
        _ => (Config::default(), false),
    };
    let (keymap, mut key_warnings) = Keymap::build(&config.keys);
    warnings.append(&mut key_warnings);
    keys::install(keymap);
    let palette = Palette::configured(&config.theme, &mut warnings);
    theme::install(palette, config.theme.color);
    let keyboard_enhancement = match std::env::var("LUUNA_TUI_KEYBOARD_ENHANCEMENT")
        .ok()
        .as_deref()
    {
        Some("0" | "false" | "off") => false,
        Some("1" | "true" | "on") => true,
        _ => config.keyboard_enhancement.unwrap_or(true),
    };
    let loaded = Loaded {
        path,
        found,
        keyboard_enhancement,
        warnings,
    };
    let _ = LOADED.set(loaded.clone());
    loaded
}

static LOADED: std::sync::OnceLock<Loaded> = std::sync::OnceLock::new();

/// What the workbench loaded at startup, for Help; `None` before loading (tests).
pub fn loaded() -> Option<&'static Loaded> {
    LOADED.get()
}

/// A complete settings file holding every default, for `luuna-tui --print-config`.
pub fn defaults_json() -> String {
    let keys: serde_json::Map<String, serde_json::Value> = keys::ACTIONS
        .iter()
        .map(|(name, _, defaults, _)| ((*name).to_string(), serde_json::json!(defaults)))
        .collect();
    let p = Palette::CLASSIC;
    let hex = |c: ratatui::style::Color| match c {
        ratatui::style::Color::Rgb(r, g, b) => format!("#{r:02x}{g:02x}{b:02x}"),
        other => format!("{other}").to_lowercase(),
    };
    let style =
        |s: theme::Slot| serde_json::json!({"fg": hex(s.fg), "bg": hex(s.bg), "bold": s.bold});
    let value = serde_json::json!({
        "keyboard_enhancement": true,
        "theme": {
            "preset": "classic",
            "styles": {
                "base": style(p.base), "panel": style(p.panel), "accent": style(p.accent),
                "selected": style(p.selected), "chrome": style(p.chrome),
                "mnemonic": style(p.mnemonic), "title": style(p.title),
            },
            "tones": {
                "success": hex(p.success), "active": hex(p.active), "danger": hex(p.danger),
                "attention": hex(p.attention), "interrupted": hex(p.interrupted),
                "neutral": hex(p.neutral),
            },
        },
        "keys": keys,
    });
    serde_json::to_string_pretty(&value).expect("serializable") + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_printed_defaults_load_without_warnings() {
        let (config, warnings) = parse(&defaults_json());
        assert!(warnings.is_empty(), "{warnings:?}");
        let (_, key_warnings) = Keymap::build(&config.keys);
        assert!(key_warnings.is_empty(), "{key_warnings:?}");
        let mut theme_warnings = Vec::new();
        assert_eq!(
            Palette::configured(&config.theme, &mut theme_warnings),
            Palette::CLASSIC
        );
        assert!(theme_warnings.is_empty(), "{theme_warnings:?}");
    }

    #[test]
    fn malformed_settings_fall_back_with_a_warning() {
        let (config, warnings) = parse("{\"keys\": {\"quit\": \"q\"}}");
        assert!(config.keys.is_empty());
        assert_eq!(warnings.len(), 1);
        let (_, warnings) = parse("{\"colour\": {}}");
        assert!(warnings[0].contains("colour"), "{warnings:?}");
    }
}
