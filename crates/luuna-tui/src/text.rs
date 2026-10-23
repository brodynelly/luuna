//! Width-aware text helpers. A terminal line longer than the pane wraps and pushes headers and
//! footers out of view, so every rendered row is either truncated to the width or wrapped to it.
//! SGR colour sequences are zero width and survive both operations; a cut row always closes the
//! colour it opened so nothing bleeds into the next row.

const RESET: &str = "\u{1b}[0m";
pub const ELLIPSIS: &str = "…";

/// The length of an SGR sequence (`ESC [ digits/semicolons m`) at the start of `text`, if any.
fn sgr_len(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    if bytes.len() < 3 || bytes[0] != 0x1b || bytes[1] != b'[' {
        return None;
    }
    let mut at = 2;
    while at < bytes.len() && (bytes[at].is_ascii_digit() || bytes[at] == b';') {
        at += 1;
    }
    (at < bytes.len() && bytes[at] == b'm').then_some(at + 1)
}

/// The text without SGR colour sequences.
pub fn strip_ansi(text: &str) -> String {
    tokens(text)
        .into_iter()
        .filter_map(|token| match token {
            Token::Char(c, _) => Some(c),
            Token::Sgr(_) => None,
        })
        .collect()
}

/// Terminal columns one code point takes: 0 for a control or combining mark, 2 for an East Asian
/// wide character, 1 otherwise.
pub fn char_width(code: u32) -> usize {
    if code == 0 || code < 32 || (0x7f..0xa0).contains(&code) {
        return 0;
    }
    if (0x0300..=0x036f).contains(&code)
        || (0x200b..=0x200f).contains(&code)
        || code == 0xfe0f
        || (0xfe20..=0xfe2f).contains(&code)
    {
        return 0;
    }
    let wide = [
        (0x1100, 0x115f),
        (0x2e80, 0x303e),
        (0x3041, 0x33ff),
        (0x3400, 0x4dbf),
        (0x4e00, 0x9fff),
        (0xa000, 0xa4cf),
        (0xac00, 0xd7a3),
        (0xf900, 0xfaff),
        (0xfe30, 0xfe4f),
        (0xff00, 0xff60),
        (0xffe0, 0xffe6),
        (0x1f300, 0x1f64f),
        (0x1f900, 0x1f9ff),
        (0x20000, 0x3fffd),
    ];
    if wide
        .iter()
        .any(|(low, high)| (*low..=*high).contains(&code))
    {
        2
    } else {
        1
    }
}

#[derive(Clone, Debug)]
enum Token {
    Sgr(String),
    Char(char, usize),
}

fn tokens(text: &str) -> Vec<Token> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(c) = rest.chars().next() {
        if c == '\u{1b}' {
            if let Some(len) = sgr_len(rest) {
                out.push(Token::Sgr(rest[..len].to_string()));
                rest = &rest[len..];
                continue;
            }
        }
        out.push(Token::Char(c, char_width(c as u32)));
        rest = &rest[c.len_utf8()..];
    }
    out
}

fn width_of(list: &[Token]) -> usize {
    list.iter()
        .map(|token| if let Token::Char(_, w) = token { *w } else { 0 })
        .sum()
}

fn join(list: &[Token]) -> String {
    list.iter()
        .map(|token| match token {
            Token::Sgr(s) => s.clone(),
            Token::Char(c, _) => c.to_string(),
        })
        .collect()
}

/// The SGR sequences still open at the end of `list`: everything since the last reset.
fn open_sgr(list: &[Token]) -> Vec<String> {
    let mut open = Vec::new();
    for token in list {
        if let Token::Sgr(s) = token {
            if s == RESET || s == "\u{1b}[m" {
                open.clear();
            } else {
                open.push(s.clone());
            }
        }
    }
    open
}

/// Columns the text occupies on a terminal: SGR sequences count nothing, wide characters two.
pub fn visible_width(text: &str) -> usize {
    width_of(&tokens(text))
}

/// The text cut to `width` columns with an ellipsis; a text that fits is returned unchanged.
pub fn truncate(text: &str, width: usize) -> String {
    if width == 0 {
        return String::new();
    }
    let list = tokens(text);
    if width_of(&list) <= width {
        return join(&list);
    }
    if width == 1 {
        return ELLIPSIS.into();
    }
    let mut kept = Vec::new();
    let mut used = 0;
    for token in list {
        match token {
            Token::Sgr(_) => kept.push(token),
            Token::Char(_, w) => {
                if used + w > width - 1 {
                    break;
                }
                used += w;
                kept.push(token);
            }
        }
    }
    format!(
        "{}{ELLIPSIS}{}",
        join(&kept),
        if open_sgr(&kept).is_empty() {
            ""
        } else {
            RESET
        }
    )
}

/// Wraps one line to rows of at most `width` columns, breaking at the last space that fits and
/// inside a word only when the word alone is wider than the row. Colour open at a row end is
/// closed there and reopened on the next row. An empty line stays one empty row.
pub fn wrap(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return vec![text.to_string()];
    }
    let mut rows = Vec::new();
    let mut current: Vec<Token> = Vec::new();
    let mut used = 0;
    let mut last_space: isize = -1;
    let mut carried: Vec<Token> = Vec::new();
    let flush = |list: &[Token], rows: &mut Vec<String>, carried: &mut Vec<Token>| {
        let mut all = carried.clone();
        all.extend_from_slice(list);
        let open = open_sgr(&all);
        rows.push(format!(
            "{}{}{}",
            join(carried),
            join(list),
            if open.is_empty() { "" } else { RESET }
        ));
        *carried = open.into_iter().map(Token::Sgr).collect();
    };
    for token in tokens(text) {
        let (c, w) = match &token {
            Token::Sgr(_) => {
                current.push(token);
                continue;
            }
            Token::Char(c, w) => (*c, *w),
        };
        if used + w > width {
            if c == ' ' {
                flush(&current, &mut rows, &mut carried);
                current.clear();
                used = 0;
                last_space = -1;
                continue;
            }
            if last_space > 0 {
                let at = last_space as usize;
                let head = current[..at].to_vec();
                let tail = current[at + 1..].to_vec();
                flush(&head, &mut rows, &mut carried);
                used = width_of(&tail);
                current = tail;
            } else {
                flush(&current, &mut rows, &mut carried);
                current.clear();
                used = 0;
            }
            last_space = -1;
        }
        if c == ' ' {
            last_space = current.len() as isize;
        }
        current.push(token);
        used += w;
    }
    flush(&current, &mut rows, &mut carried);
    rows
}

/// Every line of `text` wrapped to `width`, in order, as terminal rows.
pub fn wrap_lines(text: &str, width: usize) -> Vec<String> {
    text.split('\n')
        .flat_map(|line| wrap(line, width))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widths_truncation_and_wrapping_match_the_terminal() {
        assert_eq!(visible_width("\u{1b}[32mok\u{1b}[0m"), 2);
        assert_eq!(visible_width("日本"), 4);
        assert_eq!(truncate("abcdef", 4), "abc…");
        assert_eq!(
            truncate("\u{1b}[32mabcdef\u{1b}[0m", 4),
            "\u{1b}[32mabc…\u{1b}[0m"
        );
        assert_eq!(
            truncate("abc", 1),
            "abc".chars().take(0).collect::<String>() + if 3 <= 1 { "" } else { "…" }
        );
        assert_eq!(wrap("one two three", 7), vec!["one two", "three"]);
        assert_eq!(wrap("abcdefghij", 4), vec!["abcd", "efgh", "ij"]);
        assert_eq!(wrap("", 4), vec![""]);
        assert_eq!(
            wrap("\u{1b}[2mone two\u{1b}[0m", 4),
            vec!["\u{1b}[2mone\u{1b}[0m", "\u{1b}[2mtwo\u{1b}[0m"]
        );
        assert_eq!(strip_ansi("\u{1b}[1mx\u{1b}[0m"), "x");
    }
}
