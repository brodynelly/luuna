//! A JSON value with JavaScript semantics, so the terminal client prints exactly what the original
//! JavaScript client printed: objects keep insertion order (JSON.parse), a missing property is
//! `undefined` (omitted by JSON.stringify), numbers are IEEE doubles printed like
//! `Number.prototype.toString`, `String(x)` and template interpolation stringify like JavaScript,
//! and string lengths and slices count UTF-16 code units. serde_json's map is deliberately not used:
//! enabling its order-preserving feature would change ordering across the whole workspace.
use std::fmt::Write as _;

#[derive(Clone, Debug, PartialEq, Default)]
pub enum J {
    #[default]
    Undefined,
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

pub static UNDEFINED: J = J::Undefined;

impl J {
    pub fn str(text: impl Into<String>) -> J {
        J::Str(text.into())
    }
    pub fn num(value: impl Into<f64>) -> J {
        J::Num(value.into())
    }
    pub fn obj() -> J {
        J::Obj(Vec::new())
    }
    /// Sets (or replaces in place, keeping its position) a property; `undefined` values are kept so
    /// that JSON.stringify can omit them exactly where JavaScript would.
    pub fn set(&mut self, key: &str, value: J) -> &mut J {
        if let J::Obj(entries) = self {
            if let Some(entry) = entries.iter_mut().find(|(k, _)| k == key) {
                entry.1 = value;
            } else if let Some(index) = array_index(key) {
                // Integer-like keys come first, in ascending order (OrdinaryOwnPropertyKeys).
                let at = entries
                    .iter()
                    .position(|(k, _)| array_index(k).is_none_or(|other| other > index))
                    .unwrap_or(entries.len());
                entries.insert(at, (key.to_string(), value));
            } else {
                entries.push((key.to_string(), value));
            }
        }
        self
    }
    pub fn with(mut self, key: &str, value: J) -> J {
        self.set(key, value);
        self
    }
    /// `object[key]`: undefined when absent or when this is not an object.
    pub fn get(&self, key: &str) -> &J {
        match self {
            J::Obj(entries) => entries
                .iter()
                .find(|(k, _)| k == key)
                .map(|(_, v)| v)
                .unwrap_or(&UNDEFINED),
            J::Arr(items) if key == "length" => {
                // Only used through `len_js`; arrays expose no other named properties here.
                let _ = items;
                &UNDEFINED
            }
            _ => &UNDEFINED,
        }
    }
    pub fn at(&self, index: usize) -> &J {
        match self {
            J::Arr(items) => items.get(index).unwrap_or(&UNDEFINED),
            _ => &UNDEFINED,
        }
    }
    pub fn has(&self, key: &str) -> bool {
        matches!(self, J::Obj(entries) if entries.iter().any(|(k, _)| k == key))
    }
    pub fn is_undefined(&self) -> bool {
        matches!(self, J::Undefined)
    }
    /// `value === null || value === undefined`
    pub fn nullish(&self) -> bool {
        matches!(self, J::Undefined | J::Null)
    }
    /// JavaScript truthiness.
    pub fn truthy(&self) -> bool {
        match self {
            J::Undefined | J::Null => false,
            J::Bool(b) => *b,
            J::Num(n) => *n != 0.0 && !n.is_nan(),
            J::Str(s) => !s.is_empty(),
            J::Arr(_) | J::Obj(_) => true,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            J::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn as_f64(&self) -> Option<f64> {
        match self {
            J::Num(n) => Some(*n),
            _ => None,
        }
    }
    pub fn as_arr(&self) -> Option<&Vec<J>> {
        match self {
            J::Arr(items) => Some(items),
            _ => None,
        }
    }
    pub fn as_obj(&self) -> Option<&Vec<(String, J)>> {
        match self {
            J::Obj(entries) => Some(entries),
            _ => None,
        }
    }
    pub fn is_obj(&self) -> bool {
        matches!(self, J::Obj(_))
    }
    pub fn is_arr(&self) -> bool {
        matches!(self, J::Arr(_))
    }
    /// The items of an array, or an empty slice.
    pub fn items(&self) -> &[J] {
        match self {
            J::Arr(items) => items,
            _ => &[],
        }
    }
    /// `value ?? fallback` for display: the value when it is neither null nor undefined.
    pub fn or<'a>(&'a self, fallback: &'a J) -> &'a J {
        if self.nullish() {
            fallback
        } else {
            self
        }
    }
    /// `String(value)` / template interpolation.
    pub fn js(&self) -> String {
        match self {
            J::Undefined => "undefined".into(),
            J::Null => "null".into(),
            J::Bool(b) => b.to_string(),
            J::Num(n) => number_to_string(*n),
            J::Str(s) => s.clone(),
            J::Arr(items) => items
                .iter()
                .map(|item| {
                    if item.nullish() {
                        String::new()
                    } else {
                        item.js()
                    }
                })
                .collect::<Vec<_>>()
                .join(","),
            J::Obj(_) => "[object Object]".into(),
        }
    }
    /// `value ?? ""` stringified.
    pub fn js_or_empty(&self) -> String {
        if self.nullish() {
            String::new()
        } else {
            self.js()
        }
    }
    /// `Number(value)` for the shapes the client meets.
    pub fn to_number(&self) -> f64 {
        match self {
            J::Undefined => f64::NAN,
            J::Null => 0.0,
            J::Bool(b) => f64::from(u8::from(*b)),
            J::Num(n) => *n,
            J::Str(s) => string_to_number(s),
            J::Arr(items) => match items.len() {
                0 => 0.0,
                1 => items[0].js_or_empty_number(),
                _ => f64::NAN,
            },
            J::Obj(_) => f64::NAN,
        }
    }
    fn js_or_empty_number(&self) -> f64 {
        string_to_number(&self.js_or_empty())
    }
    /// `JSON.stringify(value)`; undefined at the top level stringifies to None.
    pub fn stringify(&self) -> Option<String> {
        let mut out = String::new();
        write_json(self, &mut out, None, 0).then_some(out)
    }
    /// `JSON.stringify(value, null, 2)`.
    pub fn stringify_pretty(&self) -> Option<String> {
        let mut out = String::new();
        write_json(self, &mut out, Some(2), 0).then_some(out)
    }
    /// The value as serde_json (for the workbench's state), keeping what JSON.parse would see.
    pub fn to_serde(&self) -> serde_json::Value {
        match self {
            J::Undefined | J::Null => serde_json::Value::Null,
            J::Bool(b) => serde_json::Value::Bool(*b),
            J::Num(n) => {
                if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
                    serde_json::Value::from(*n as i64)
                } else {
                    serde_json::Number::from_f64(*n)
                        .map(serde_json::Value::Number)
                        .unwrap_or(serde_json::Value::Null)
                }
            }
            J::Str(s) => serde_json::Value::String(s.clone()),
            J::Arr(items) => serde_json::Value::Array(
                items
                    .iter()
                    .map(|item| {
                        if item.is_undefined() {
                            serde_json::Value::Null
                        } else {
                            item.to_serde()
                        }
                    })
                    .collect(),
            ),
            J::Obj(entries) => serde_json::Value::Object(
                entries
                    .iter()
                    .filter(|(_, v)| !v.is_undefined())
                    .map(|(k, v)| (k.clone(), v.to_serde()))
                    .collect(),
            ),
        }
    }
    pub fn from_serde(value: &serde_json::Value) -> J {
        match value {
            serde_json::Value::Null => J::Null,
            serde_json::Value::Bool(b) => J::Bool(*b),
            serde_json::Value::Number(n) => J::Num(n.as_f64().unwrap_or(f64::NAN)),
            serde_json::Value::String(s) => J::Str(s.clone()),
            serde_json::Value::Array(items) => J::Arr(items.iter().map(J::from_serde).collect()),
            serde_json::Value::Object(map) => J::Obj(
                map.iter()
                    .map(|(k, v)| (k.clone(), J::from_serde(v)))
                    .collect(),
            ),
        }
    }
}

impl From<&str> for J {
    fn from(value: &str) -> Self {
        J::Str(value.into())
    }
}
impl From<String> for J {
    fn from(value: String) -> Self {
        J::Str(value)
    }
}
impl From<bool> for J {
    fn from(value: bool) -> Self {
        J::Bool(value)
    }
}
impl From<f64> for J {
    fn from(value: f64) -> Self {
        J::Num(value)
    }
}
impl From<i64> for J {
    fn from(value: i64) -> Self {
        J::Num(value as f64)
    }
}
impl From<usize> for J {
    fn from(value: usize) -> Self {
        J::Num(value as f64)
    }
}
impl From<Vec<J>> for J {
    fn from(value: Vec<J>) -> Self {
        J::Arr(value)
    }
}

/// The array index a property key denotes (`"0"`, `"17"`; not `"01"` or `"4294967295"`).
fn array_index(key: &str) -> Option<u32> {
    if key.is_empty()
        || (key.len() > 1 && key.starts_with('0'))
        || !key.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    key.parse::<u64>()
        .ok()
        .filter(|n| *n < 4_294_967_295)
        .map(|n| n as u32)
}

/// Builds an object literal in insertion order: `obj![("a", x), ("b", y)]`.
#[macro_export]
macro_rules! obj {
    ($(($key:expr, $value:expr)),* $(,)?) => {{
        let mut object = $crate::js::J::obj();
        $( object.set($key, $crate::js::J::from($value)); )*
        object
    }};
}

/// `Number(string)`: trimmed decimal, hex, binary, octal, Infinity; empty is 0; anything else NaN.
pub fn string_to_number(text: &str) -> f64 {
    let trimmed = text.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}');
    if trimmed.is_empty() {
        return 0.0;
    }
    let lower = trimmed.to_ascii_lowercase();
    for (prefix, radix) in [("0x", 16), ("0b", 2), ("0o", 8)] {
        if let Some(digits) = lower.strip_prefix(prefix) {
            return if !digits.is_empty() && digits.chars().all(|c| c.is_digit(radix)) {
                digits.chars().fold(0.0, |acc, c| {
                    acc * radix as f64 + c.to_digit(radix).unwrap() as f64
                })
            } else {
                f64::NAN
            };
        }
    }
    match trimmed {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // StrDecimalLiteral: digits with an optional fraction and exponent, no "inf"/"nan" words.
    let body = trimmed.strip_prefix(['+', '-']).unwrap_or(trimmed);
    let valid = !body.is_empty()
        && body
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '.' | 'e' | 'E' | '+' | '-'))
        && body
            .chars()
            .next()
            .is_some_and(|c| c.is_ascii_digit() || c == '.')
        && body != ".";
    if !valid {
        return f64::NAN;
    }
    trimmed.parse::<f64>().unwrap_or(f64::NAN)
}

/// `Number.prototype.toString()` for a double.
pub fn number_to_string(value: f64) -> String {
    if value.is_nan() {
        return "NaN".into();
    }
    if value == 0.0 {
        return "0".into();
    }
    if value.is_infinite() {
        return if value > 0.0 {
            "Infinity".into()
        } else {
            "-Infinity".into()
        };
    }
    let sign = if value < 0.0 { "-" } else { "" };
    // Rust's `{:e}` is the shortest round-trip digits in scientific form: d[.ddd]e<exp>.
    let scientific = format!("{:e}", value.abs());
    let (mantissa, exponent) = scientific.split_once('e').unwrap();
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exponent.parse::<i32>().unwrap() + 1;
    let body = if k <= n && n <= 21 {
        format!("{digits}{}", "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{digits}", "0".repeat((-n) as usize))
    } else {
        let e = n - 1;
        let exp = if e >= 0 {
            format!("+{e}")
        } else {
            e.to_string()
        };
        if k == 1 {
            format!("{digits}e{exp}")
        } else {
            format!("{}.{}e{exp}", &digits[..1], &digits[1..])
        }
    };
    format!("{sign}{body}")
}

fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// Writes JSON like JSON.stringify; returns false for a value JSON omits (undefined).
fn write_json(value: &J, out: &mut String, indent: Option<usize>, depth: usize) -> bool {
    let newline = |out: &mut String, level: usize| {
        if let Some(width) = indent {
            out.push('\n');
            out.push_str(&" ".repeat(width * level));
        }
    };
    match value {
        J::Undefined => return false,
        J::Null => out.push_str("null"),
        J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        J::Num(n) => out.push_str(&if n.is_finite() {
            number_to_string(*n)
        } else {
            "null".into()
        }),
        J::Str(s) => write_string(s, out),
        J::Arr(items) => {
            if items.is_empty() {
                out.push_str("[]");
                return true;
            }
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                newline(out, depth + 1);
                if !write_json(item, out, indent, depth + 1) {
                    out.push_str("null");
                }
            }
            newline(out, depth);
            out.push(']');
        }
        J::Obj(entries) => {
            let present: Vec<_> = entries.iter().filter(|(_, v)| !v.is_undefined()).collect();
            if present.is_empty() {
                out.push_str("{}");
                return true;
            }
            out.push('{');
            for (index, (key, item)) in present.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                newline(out, depth + 1);
                write_string(key, out);
                out.push(':');
                if indent.is_some() {
                    out.push(' ');
                }
                write_json(item, out, indent, depth + 1);
            }
            newline(out, depth);
            out.push('}');
        }
    }
    true
}

/// A JSON.parse failure, worded exactly like V8's message.
#[derive(Debug, Clone, PartialEq)]
pub struct SyntaxError(pub String);

/// `JSON.parse(text)`: duplicate keys keep their first position and their last value.
pub fn parse(text: &str) -> Result<J, SyntaxError> {
    let chars: Vec<char> = text.chars().collect();
    let mut offsets = Vec::with_capacity(chars.len() + 1);
    let mut unit = 0;
    for c in &chars {
        offsets.push(unit);
        unit += c.len_utf16();
    }
    offsets.push(unit);
    let mut parser = Parser {
        chars,
        offsets,
        units: text.encode_utf16().collect(),
        at: 0,
    };
    parser.skip();
    let value = parser.value()?;
    parser.skip();
    if parser.at < parser.chars.len() {
        return Err(parser.positioned("Unexpected non-whitespace character after JSON", parser.at));
    }
    Ok(value)
}

struct Parser {
    chars: Vec<char>,
    /// UTF-16 offset of each char index (and of the end).
    offsets: Vec<usize>,
    units: Vec<u16>,
    at: usize,
}

const CONTEXT: usize = 10;

impl Parser {
    /// `<message> at position <p> (line <l> column <c>)`, positions in UTF-16 units.
    fn positioned(&self, message: &str, index: usize) -> SyntaxError {
        let position = self.offsets[index.min(self.chars.len())];
        let before = &self.units[..position];
        let line = 1 + before.iter().filter(|u| **u == u16::from(b'\n')).count();
        let line_start = before
            .iter()
            .rposition(|u| *u == u16::from(b'\n'))
            .map(|i| i + 1)
            .unwrap_or(0);
        SyntaxError(format!(
            "{message} at position {position} (line {line} column {})",
            position - line_start + 1
        ))
    }
    /// The unexpected-token message at `index` (end of input when there is no token).
    fn unexpected_at(&self, index: usize) -> SyntaxError {
        let Some(token) = self.chars.get(index) else {
            return SyntaxError("Unexpected end of JSON input".into());
        };
        let length = self.units.len();
        let position = self.offsets[index];
        let text =
            |from: usize, to: usize| String::from_utf16_lossy(&self.units[from..to.min(length)]);
        let context = if length < CONTEXT * 2 + 1 {
            format!("\"{}\"", text(0, length))
        } else if position < CONTEXT {
            format!("\"{}\"...", text(0, position + CONTEXT))
        } else if position < length - CONTEXT {
            format!("...\"{}\"...", text(position - CONTEXT, position + CONTEXT))
        } else {
            format!("...\"{}\"", text(position - CONTEXT, length))
        };
        SyntaxError(format!(
            "Unexpected token '{token}', {context} is not valid JSON"
        ))
    }
    fn peek(&self) -> Option<char> {
        self.chars.get(self.at).copied()
    }
    fn skip(&mut self) {
        while matches!(self.peek(), Some(' ' | '\t' | '\n' | '\r')) {
            self.at += 1;
        }
    }
    fn literal(&mut self, word: &str, value: J) -> Result<J, SyntaxError> {
        for expected in word.chars() {
            match self.peek() {
                Some(c) if c == expected => self.at += 1,
                _ => return Err(self.unexpected_at(self.at)),
            }
        }
        Ok(value)
    }
    fn value(&mut self) -> Result<J, SyntaxError> {
        match self.peek() {
            Some('{') => self.object(),
            Some('[') => self.array(),
            Some('"') => Ok(J::Str(self.string()?)),
            Some('t') => self.literal("true", J::Bool(true)),
            Some('f') => self.literal("false", J::Bool(false)),
            Some('n') => self.literal("null", J::Null),
            Some(c) if c == '-' || c.is_ascii_digit() => self.number(),
            _ => Err(self.unexpected_at(self.at)),
        }
    }
    fn digits(&mut self) -> usize {
        let start = self.at;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.at += 1;
        }
        self.at - start
    }
    fn number(&mut self) -> Result<J, SyntaxError> {
        let start = self.at;
        if self.peek() == Some('-') {
            self.at += 1;
            if !self.peek().is_some_and(|c| c.is_ascii_digit()) {
                return Err(self.positioned("No number after minus sign in JSON", self.at));
            }
        }
        if self.peek() == Some('0') {
            self.at += 1;
            if self.peek().is_some_and(|c| c.is_ascii_digit()) {
                return Err(self.positioned("Unexpected number in JSON", self.at));
            }
        } else {
            self.digits();
        }
        if self.peek() == Some('.') {
            self.at += 1;
            if self.digits() == 0 {
                return Err(self.positioned("Unterminated fractional number in JSON", self.at));
            }
        }
        if matches!(self.peek(), Some('e' | 'E')) {
            self.at += 1;
            if matches!(self.peek(), Some('+' | '-')) {
                self.at += 1;
            }
            if self.digits() == 0 {
                return Err(self.positioned("Exponent part is missing a number in JSON", self.at));
            }
        }
        let text: String = self.chars[start..self.at].iter().collect();
        Ok(J::Num(text.parse::<f64>().unwrap_or(f64::NAN)))
    }
    fn string(&mut self) -> Result<String, SyntaxError> {
        self.at += 1;
        let mut units: Vec<u16> = Vec::new();
        loop {
            let Some(c) = self.peek() else {
                return Err(self.positioned("Unterminated string in JSON", self.at));
            };
            match c {
                '"' => {
                    self.at += 1;
                    break;
                }
                '\\' => {
                    self.at += 1;
                    let Some(escape) = self.peek() else {
                        return Err(SyntaxError("Unexpected end of JSON input".into()));
                    };
                    let simple = match escape {
                        '"' => Some('"'),
                        '\\' => Some('\\'),
                        '/' => Some('/'),
                        'b' => Some('\u{8}'),
                        'f' => Some('\u{c}'),
                        'n' => Some('\n'),
                        'r' => Some('\r'),
                        't' => Some('\t'),
                        _ => None,
                    };
                    if let Some(ch) = simple {
                        units.push(ch as u16);
                        self.at += 1;
                        continue;
                    }
                    if escape != 'u' {
                        return Err(self.positioned("Bad escaped character in JSON", self.at));
                    }
                    self.at += 1;
                    let mut code: u16 = 0;
                    for _ in 0..4 {
                        match self.peek().and_then(|h| h.to_digit(16)) {
                            Some(d) => {
                                code = code * 16 + d as u16;
                                self.at += 1;
                            }
                            None if self.peek().is_none() => {
                                return Err(SyntaxError("Unexpected end of JSON input".into()))
                            }
                            None => {
                                return Err(self.positioned("Bad Unicode escape in JSON", self.at))
                            }
                        }
                    }
                    units.push(code);
                }
                c if (c as u32) < 0x20 => {
                    return Err(
                        self.positioned("Bad control character in string literal in JSON", self.at)
                    )
                }
                c => {
                    let mut buffer = [0u16; 2];
                    units.extend_from_slice(c.encode_utf16(&mut buffer));
                    self.at += 1;
                }
            }
        }
        // Lone surrogates have no Rust representation; they become U+FFFD.
        Ok(String::from_utf16_lossy(&units))
    }
    fn array(&mut self) -> Result<J, SyntaxError> {
        self.at += 1;
        let mut items = Vec::new();
        self.skip();
        if self.peek() == Some(']') {
            self.at += 1;
            return Ok(J::Arr(items));
        }
        loop {
            self.skip();
            items.push(self.value()?);
            self.skip();
            match self.peek() {
                Some(',') => self.at += 1,
                Some(']') => {
                    self.at += 1;
                    return Ok(J::Arr(items));
                }
                _ => {
                    return Err(
                        self.positioned("Expected ',' or ']' after array element in JSON", self.at)
                    )
                }
            }
        }
    }
    fn object(&mut self) -> Result<J, SyntaxError> {
        self.at += 1;
        let mut object = J::obj();
        self.skip();
        match self.peek() {
            Some('}') => {
                self.at += 1;
                return Ok(object);
            }
            Some('"') => {}
            _ => return Err(self.positioned("Expected property name or '}' in JSON", self.at)),
        }
        loop {
            self.skip();
            if self.peek() != Some('"') {
                return Err(
                    self.positioned("Expected double-quoted property name in JSON", self.at)
                );
            }
            let key = self.string()?;
            self.skip();
            if self.peek() != Some(':') {
                return Err(self.positioned("Expected ':' after property name in JSON", self.at));
            }
            self.at += 1;
            self.skip();
            let value = self.value()?;
            object.set(&key, value);
            self.skip();
            match self.peek() {
                Some(',') => self.at += 1,
                Some('}') => {
                    self.at += 1;
                    return Ok(object);
                }
                _ => {
                    return Err(self
                        .positioned("Expected ',' or '}' after property value in JSON", self.at))
                }
            }
        }
    }
}

/// UTF-16 length, JavaScript's `string.length`.
pub fn len16(text: &str) -> usize {
    text.encode_utf16().count()
}

/// `string.slice(start, end)` in UTF-16 code units (negative indexes count from the end).
pub fn slice16(text: &str, start: isize, end: Option<isize>) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    let len = units.len() as isize;
    let clamp = |i: isize| if i < 0 { (len + i).max(0) } else { i.min(len) } as usize;
    let from = clamp(start);
    let to = clamp(end.unwrap_or(len));
    if from >= to {
        return String::new();
    }
    String::from_utf16_lossy(&units[from..to])
}

/// `string.padEnd(width)` / `padStart` with spaces, counting UTF-16 units.
pub fn pad_end(text: &str, width: usize) -> String {
    let len = len16(text);
    if len >= width {
        text.to_string()
    } else {
        format!("{text}{}", " ".repeat(width - len))
    }
}
pub fn pad_start(text: &str, width: usize) -> String {
    let len = len16(text);
    if len >= width {
        text.to_string()
    } else {
        format!("{}{text}", " ".repeat(width - len))
    }
}

/// `Number.isSafeInteger(value)`.
pub fn safe_integer(value: f64) -> bool {
    value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0
}

/// `Number(x).toFixed(digits)` for the money values the client prints.
pub fn to_fixed(value: f64, digits: usize) -> String {
    if !value.is_finite() {
        return number_to_string(value);
    }
    if value.abs() >= 1e21 {
        return number_to_string(value);
    }
    // toFixed rounds the exact binary value half up; format! rounds half to even on the exact
    // binary value, which differs only for values exactly halfway in binary, never for the
    // micros-to-dollars divisions printed here.
    format!("{value:.digits$}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numbers_print_like_javascript() {
        for (value, text) in [
            (0.0, "0"),
            (-0.0, "0"),
            (1.0, "1"),
            (1.5, "1.5"),
            (0.1, "0.1"),
            (1e21, "1e+21"),
            (1e20, "100000000000000000000"),
            (1e-7, "1e-7"),
            (0.000001, "0.000001"),
            (123456789.123, "123456789.123"),
            (-2.5e-10, "-2.5e-10"),
            (9007199254740993.0, "9007199254740992"),
        ] {
            assert_eq!(number_to_string(value), text, "{value}");
        }
    }

    #[test]
    fn parse_and_stringify_round_trip_in_order() {
        let text = r#"{"b":1,"a":[true,null,"x\u001b\"y"],"c":{"z":1.0,"y":-0},"b":2}"#;
        let value = parse(text).unwrap();
        assert_eq!(
            value.stringify().unwrap(),
            r#"{"b":2,"a":[true,null,"x\u001b\"y"],"c":{"z":1,"y":0}}"#
        );
        assert_eq!(parse("[]").unwrap().stringify_pretty().unwrap(), "[]");
        assert_eq!(
            parse(r#"{"a":[1,{}]}"#)
                .unwrap()
                .stringify_pretty()
                .unwrap(),
            "{\n  \"a\": [\n    1,\n    {}\n  ]\n}"
        );
        for (text, message) in [
            (
                "{",
                "Expected property name or '}' in JSON at position 1 (line 1 column 2)",
            ),
            ("[", "Unexpected end of JSON input"),
            (
                "[1 2]",
                "Expected ',' or ']' after array element in JSON at position 3 (line 1 column 4)",
            ),
            (
                "{\"a\":1,}",
                "Expected double-quoted property name in JSON at position 7 (line 1 column 8)",
            ),
            (
                "01",
                "Unexpected number in JSON at position 1 (line 1 column 2)",
            ),
            (
                "1 2",
                "Unexpected non-whitespace character after JSON at position 2 (line 1 column 3)",
            ),
            (
                "abcdefghijklmnopqrstuvwxyz",
                "Unexpected token 'a', \"abcdefghij\"... is not valid JSON",
            ),
            (
                "<html>",
                "Unexpected token '<', \"<html>\" is not valid JSON",
            ),
            (
                "{\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\": x}",
                "Unexpected token 'x', ...\"aaaaaaa\": x}\" is not valid JSON",
            ),
            (
                "\"a\nb\"",
                "Bad control character in string literal in JSON at position 2 (line 1 column 3)",
            ),
            (
                "1.e",
                "Unterminated fractional number in JSON at position 2 (line 1 column 3)",
            ),
            (
                "[-]",
                "No number after minus sign in JSON at position 2 (line 1 column 3)",
            ),
            ("tru", "Unexpected end of JSON input"),
            ("[1,]", "Unexpected token ']', \"[1,]\" is not valid JSON"),
            (
                "{\n\"a\":\n,}",
                "Unexpected token ',', \"{\n\"a\":\n,}\" is not valid JSON",
            ),
        ] {
            assert_eq!(parse(text).unwrap_err().0, message, "{text}");
        }
        let mut object = J::obj();
        object.set("x", J::Undefined).set("y", J::Null);
        assert_eq!(object.stringify().unwrap(), r#"{"y":null}"#);
        assert_eq!(J::Arr(vec![J::Undefined]).stringify().unwrap(), "[null]");
        assert_eq!(
            parse(r#"{"b":1,"2":0,"a":2,"1":3,"01":4}"#)
                .unwrap()
                .stringify()
                .unwrap(),
            r#"{"1":3,"2":0,"b":1,"a":2,"01":4}"#
        );
    }

    #[test]
    fn string_semantics_count_utf16() {
        assert_eq!(len16("a😀"), 3);
        assert_eq!(slice16("abcdef", 0, Some(3)), "abc");
        assert_eq!(slice16("abcdef", 7, Some(31)), "");
        assert_eq!(slice16("abcdef", -2, None), "ef");
        assert_eq!(string_to_number(" 12 "), 12.0);
        assert!(string_to_number("12a").is_nan());
        assert_eq!(string_to_number(""), 0.0);
        assert_eq!(J::Arr(vec![J::str("a"), J::Null, J::num(1)]).js(), "a,,1");
        assert_eq!(to_fixed(0.0123, 4), "0.0123");
    }
}
