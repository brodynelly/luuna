//! Deterministic pre-push policy (docs/08-validation.md "Publication
//! rules"): before any candidate commit leaves the host, the exact patch
//! between the planned base and the frozen candidate commit is scanned for
//! credential-shaped content, files that are credential stores by name, and
//! paths outside the approved task scope. The check is pure text analysis
//! over the candidate diff: no model, no network, no repository code runs.
//!
//! A finding names the repository, the path and the rule, never the matched
//! text, so the refusal itself cannot leak what it found. The reviewer's
//! "secrets exposure" judgement is advisory; this gate is the deterministic
//! one the specification requires, and it fails closed when a section of the
//! patch could not be read.
use luuna_domain::{check_scope, ChangedPath, PlanRevision};
use luuna_git::{DiffFile, DiffShown, ReviewDiff};
use serde::Serialize;

/// One policy violation in a candidate's patch. `detail` describes the rule,
/// not the content.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PolicyFinding {
    pub repository_id: String,
    pub path: String,
    pub rule: &'static str,
    pub detail: String,
}

impl PolicyFinding {
    fn new(repository_id: &str, path: &str, rule: &'static str, detail: impl Into<String>) -> Self {
        Self {
            repository_id: repository_id.to_owned(),
            path: path.to_owned(),
            rule,
            detail: detail.into(),
        }
    }
}

/// Basenames that are credential stores whatever their content.
const CREDENTIAL_BASENAMES: &[&str] = &[
    ".netrc",
    "_netrc",
    ".pypirc",
    ".npmrc",
    ".git-credentials",
    ".htpasswd",
    ".pgpass",
    "credentials",
    "credentials.json",
    "secrets.json",
    "secrets.yaml",
    "secrets.yml",
    "id_rsa",
    "id_dsa",
    "id_ecdsa",
    "id_ed25519",
];

/// Extensions of key material and credential bundles.
const CREDENTIAL_EXTENSIONS: &[&str] =
    &["pem", "key", "p12", "pfx", "jks", "keystore", "ppk", "kdbx"];

/// `.env` files are configuration-with-secrets by convention; the documented
/// placeholders are not.
const ENV_PLACEHOLDER_SUFFIXES: &[&str] = &[".example", ".sample", ".template", ".dist"];

fn basename(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Whether a path names a credential store (an added or modified file; a
/// deletion removes one and is never a finding).
pub fn credential_path(path: &str) -> Option<&'static str> {
    let name = basename(path);
    let lower = name.to_ascii_lowercase();
    if lower == ".env" {
        return Some("a .env file carries environment secrets");
    }
    if let Some(rest) = lower.strip_prefix(".env.") {
        if !ENV_PLACEHOLDER_SUFFIXES
            .iter()
            .any(|suffix| rest == &suffix[1..] || rest.ends_with(suffix))
        {
            return Some("a .env.* file carries environment secrets");
        }
    }
    if CREDENTIAL_BASENAMES.contains(&lower.as_str()) {
        return Some("the file is a credential store by name");
    }
    if let Some((_, extension)) = lower.rsplit_once('.') {
        if CREDENTIAL_EXTENSIONS.contains(&extension) && !lower.ends_with(".pub") {
            return Some("the file extension names key material or a credential bundle");
        }
    }
    if path.split('/').any(|component| {
        component.eq_ignore_ascii_case(".aws") || component.eq_ignore_ascii_case(".ssh")
    }) {
        return Some("the path lies under a credential directory");
    }
    None
}

fn token_run(bytes: &[u8], from: usize, allowed: impl Fn(u8) -> bool) -> usize {
    bytes[from..].iter().take_while(|b| allowed(**b)).count()
}

fn is_token_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_' || b == b'-'
}

/// Known credential prefixes: the prefix followed by at least `min` token
/// characters. Each entry is (prefix, minimum length after it, label).
const PREFIXED_TOKENS: &[(&str, usize, &str)] = &[
    ("ghp_", 36, "a GitHub personal access token"),
    ("gho_", 36, "a GitHub OAuth token"),
    ("ghu_", 36, "a GitHub user-to-server token"),
    ("ghs_", 36, "a GitHub server token"),
    ("ghr_", 36, "a GitHub refresh token"),
    ("github_pat_", 22, "a GitHub fine-grained token"),
    ("xoxb-", 10, "a Slack bot token"),
    ("xoxp-", 10, "a Slack user token"),
    ("xoxa-", 10, "a Slack token"),
    ("xoxr-", 10, "a Slack token"),
    ("xoxs-", 10, "a Slack token"),
    ("sk-ant-", 20, "an Anthropic API key"),
    ("sk_live_", 16, "a Stripe live secret key"),
    ("rk_live_", 16, "a Stripe live restricted key"),
    ("npm_", 36, "an npm access token"),
    ("AIza", 35, "a Google API key"),
    ("AKIA", 16, "an AWS access key ID"),
    ("ASIA", 16, "an AWS temporary access key ID"),
    ("glpat-", 20, "a GitLab personal access token"),
];

/// Identifiers whose assigned literal is a credential by name.
const SECRET_IDENTIFIERS: &[&str] = &[
    "password",
    "passwd",
    "secret",
    "token",
    "apikey",
    "api_key",
    "api-key",
    "access_key",
    "accesskey",
    "private_key",
    "privatekey",
    "client_secret",
    "auth_token",
    "authtoken",
];

/// Text that marks a value as a placeholder, a reference to the environment
/// or documentation rather than a credential.
const PLACEHOLDER_MARKERS: &[&str] = &[
    "${",
    "{{",
    "<",
    ">",
    "process.env",
    "os.environ",
    "getenv",
    "env(",
    "example",
    "placeholder",
    "your",
    "changeme",
    "xxxx",
    "****",
    "redacted",
    "dummy",
    "sample",
    "secretsmanager",
];

fn looks_like_placeholder(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    PLACEHOLDER_MARKERS
        .iter()
        .any(|marker| lower.contains(marker))
        || matches!(lower.as_str(), "null" | "none" | "true" | "false")
}

/// A literal that could be a credential: long enough, no whitespace, mixing
/// letters and digits (or punctuation typical of generated secrets).
fn credential_shaped(value: &str) -> bool {
    let value = value.trim_matches(|c| c == '"' || c == '\'' || c == '`' || c == ',' || c == ';');
    if value.len() < 16 || value.chars().any(char::is_whitespace) || looks_like_placeholder(value) {
        return false;
    }
    let letters = value.chars().filter(|c| c.is_ascii_alphabetic()).count();
    let digits = value.chars().filter(|c| c.is_ascii_digit()).count();
    let symbols = value.chars().filter(|c| !c.is_ascii_alphanumeric()).count();
    letters > 0 && (digits >= 2 || symbols >= 2)
}

/// A `key = value` / `key: value` assignment whose key ends in a secret
/// identifier and whose value is a credential-shaped literal.
fn secret_assignment(line: &str) -> bool {
    let bytes = line.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'=' || bytes[index] == b':' {
            // The key may be quoted (JSON, YAML); the identifier is its last
            // run of identifier characters, found on a character boundary so
            // a multibyte character before it cannot split a code point.
            let key = line[..index].trim_end().trim_end_matches(['"', '\'']);
            let key_end = key
                .char_indices()
                .rev()
                .find(|(_, c)| !(c.is_ascii_alphanumeric() || *c == '_' || *c == '-' || *c == '.'))
                .map_or(0, |(at, c)| at + c.len_utf8());
            let identifier = key[key_end..].to_ascii_lowercase();
            if !identifier.is_empty()
                && SECRET_IDENTIFIERS
                    .iter()
                    .any(|name| identifier.ends_with(name))
            {
                let mut rest = line[index + 1..].trim_start();
                if rest.starts_with('=') {
                    // `==` comparisons are never assignments.
                    index += 1;
                    continue;
                }
                if let Some(stripped) = rest.strip_prefix("\"") {
                    rest = stripped.split('"').next().unwrap_or_default();
                } else if let Some(stripped) = rest.strip_prefix('\'') {
                    rest = stripped.split('\'').next().unwrap_or_default();
                } else {
                    rest = rest.split_whitespace().next().unwrap_or_default();
                }
                if credential_shaped(rest) {
                    return true;
                }
            }
        }
        index += 1;
    }
    false
}

/// `scheme://user:password@host` with a real-looking password.
fn url_credential(line: &str) -> bool {
    let mut search = 0;
    while let Some(at) = line[search..].find("://") {
        let start = search + at + 3;
        let authority_end = line[start..]
            .find(|c: char| c == '/' || c.is_whitespace() || c == '"' || c == '\'' || c == ')')
            .map_or(line.len(), |end| start + end);
        let authority = &line[start..authority_end];
        if let Some((userinfo, _)) = authority.rsplit_once('@') {
            if let Some((_, password)) = userinfo.split_once(':') {
                if password.len() >= 8 && !looks_like_placeholder(password) {
                    return true;
                }
            }
        }
        search = start;
    }
    false
}

fn jwt(line: &str) -> bool {
    let bytes = line.as_bytes();
    let mut from = 0;
    while let Some(at) = line[from..].find("eyJ") {
        let start = from + at;
        let first = token_run(bytes, start, is_token_byte);
        if first >= 13 && bytes.get(start + first) == Some(&b'.') {
            let second_start = start + first + 1;
            if line[second_start..].starts_with("eyJ") {
                let second = token_run(bytes, second_start, is_token_byte);
                if second >= 13 && bytes.get(second_start + second) == Some(&b'.') {
                    return true;
                }
            }
        }
        from = start + 3;
    }
    false
}

fn prefixed_token(line: &str) -> Option<&'static str> {
    let bytes = line.as_bytes();
    for (prefix, min, label) in PREFIXED_TOKENS {
        let mut from = 0;
        while let Some(at) = line[from..].find(prefix) {
            let start = from + at;
            let preceded_by_token = start > 0 && is_token_byte(bytes[start - 1]);
            let run = token_run(bytes, start + prefix.len(), is_token_byte);
            if !preceded_by_token && run >= *min {
                return Some(label);
            }
            from = start + prefix.len();
        }
    }
    None
}

/// The rule one added line violates, if any. `known` holds exact credential
/// values this runtime was configured with; their presence is reported by
/// rule only.
pub fn line_finding(line: &str, known: &[String]) -> Option<(&'static str, &'static str)> {
    if known
        .iter()
        .any(|secret| !secret.is_empty() && line.contains(secret.as_str()))
    {
        return Some((
            "known-credential",
            "a credential value configured for this runtime",
        ));
    }
    if line.contains("-----BEGIN ") && line.contains("PRIVATE KEY-----") {
        return Some(("private-key", "a private key block"));
    }
    if line.contains("PuTTY-User-Key-File") {
        return Some(("private-key", "a PuTTY private key file"));
    }
    if let Some(label) = prefixed_token(line) {
        return Some(("credential-token", label));
    }
    if jwt(line) {
        return Some(("credential-token", "a signed JSON web token"));
    }
    if url_credential(line) {
        return Some(("url-credential", "a password inside a URL"));
    }
    if secret_assignment(line) {
        return Some((
            "secret-assignment",
            "a credential-shaped literal assigned to a secret-named key",
        ));
    }
    None
}

/// Added lines of a unified diff, with the path of the section they belong
/// to (from the `+++ b/<path>` header; `/dev/null` sections are deletions).
fn added_lines(text: &str) -> Vec<(String, usize, String)> {
    let mut lines = Vec::new();
    let mut path: Option<String> = None;
    let mut line_number = 0usize;
    for line in text.lines() {
        if let Some(header) = line.strip_prefix("+++ ") {
            // Git quotes a path with unusual bytes (`+++ "b/caf\303\251"`);
            // decoded, it names the same file as `diff.files`.
            let header = unquote_git_path(header);
            path = header
                .strip_prefix("b/")
                .filter(|p| *p != "/dev/null")
                .map(ToOwned::to_owned);
            line_number = 0;
            continue;
        }
        if line.starts_with("--- ") || line.starts_with("diff --git ") {
            continue;
        }
        if let Some(hunk) = line.strip_prefix("@@ ") {
            // `@@ -a,b +c,d @@`: the new-side start line.
            if let Some(plus) = hunk.split_whitespace().nth(1) {
                line_number = plus
                    .trim_start_matches('+')
                    .split(',')
                    .next()
                    .and_then(|n| n.parse::<usize>().ok())
                    .unwrap_or(1)
                    .saturating_sub(1);
            }
            continue;
        }
        if let Some(added) = line.strip_prefix('+') {
            line_number += 1;
            if let Some(path) = &path {
                lines.push((path.clone(), line_number, added.to_owned()));
            }
        } else if !line.starts_with('-') && !line.starts_with('\\') {
            line_number += 1;
        }
    }
    lines
}

/// Decode Git's C-style quoting of a path (`"..."` with `\\`, `\"`, `\t`,
/// `\n` and `\ooo` octal escapes); an unquoted path is returned as is.
fn unquote_git_path(text: &str) -> String {
    let Some(inner) = text
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    else {
        return text.to_owned();
    };
    let bytes = inner.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            let next = bytes[i + 1];
            if next.is_ascii_digit() && i + 3 < bytes.len() {
                let octal = &inner[i + 1..i + 4];
                if let Ok(value) = u8::from_str_radix(octal, 8) {
                    out.push(value);
                    i += 4;
                    continue;
                }
            }
            out.push(match next {
                b'n' => b'\n',
                b't' => b'\t',
                b'r' => b'\r',
                b'a' => 7,
                b'b' => 8,
                b'f' => 12,
                b'v' => 11,
                other => other,
            });
            i += 2;
            continue;
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The content of a file the patch could only summarize (binary or
/// non-UTF-8), read from its blob by the caller; `None` when it could not be
/// read, which is a finding.
pub struct BinaryContent {
    pub path: String,
    pub bytes: Option<Vec<u8>>,
}

fn changed_path(file: &DiffFile) -> ChangedPath {
    ChangedPath {
        path: file.path.clone(),
        status: file.status.clone(),
        original_path: None,
    }
}

/// Scan one repository's candidate patch. `plan` supplies the approved task
/// scope for the repository; `known` the runtime's own credential values.
pub fn scan_repository(
    repository_id: &str,
    plan: &PlanRevision,
    diff: &ReviewDiff,
    known: &[String],
    binary: &[BinaryContent],
) -> Vec<PolicyFinding> {
    let mut findings = Vec::new();
    // Approved scope: the same rule the writer's post-session judgement
    // applies, re-checked against the exact patch that will be pushed.
    if let Some(task) = plan
        .tasks
        .iter()
        .find(|task| task.repository_id == repository_id)
    {
        let changes: Vec<ChangedPath> = diff.files.iter().map(changed_path).collect();
        if let Err(violation) = check_scope(&changes, task, &plan.permissions) {
            findings.push(PolicyFinding::new(
                repository_id,
                "",
                "scope",
                violation.to_string(),
            ));
        }
    } else {
        findings.push(PolicyFinding::new(
            repository_id,
            "",
            "scope",
            "the plan has no task for this repository",
        ));
    }
    for file in &diff.files {
        if file.status == "D" {
            continue;
        }
        if let Some(detail) = credential_path(&file.path) {
            findings.push(PolicyFinding::new(
                repository_id,
                &file.path,
                "credential-path",
                detail,
            ));
        }
        match file.shown {
            DiffShown::Omitted => findings.push(PolicyFinding::new(
                repository_id,
                &file.path,
                "unscanned",
                "the file's patch exceeded the scan budget, so its content could not be checked",
            )),
            DiffShown::Summary => {
                // A summary names blobs, not content: the caller read the
                // blob, and its bytes are scanned line by line (lossily
                // decoded, which keeps every ASCII credential intact).
                match binary.iter().find(|b| b.path == file.path) {
                    Some(BinaryContent {
                        bytes: Some(bytes), ..
                    }) => {
                        let text = String::from_utf8_lossy(bytes);
                        for (number, line) in text.lines().enumerate() {
                            if let Some((rule, detail)) = line_finding(line, known) {
                                findings.push(PolicyFinding::new(
                                    repository_id,
                                    &file.path,
                                    rule,
                                    format!(
                                        "{detail} (first at line {} of the binary or non-UTF-8 candidate file)",
                                        number + 1
                                    ),
                                ));
                                break;
                            }
                        }
                    }
                    _ => findings.push(PolicyFinding::new(
                        repository_id,
                        &file.path,
                        "unscanned",
                        "the file is binary or not UTF-8 and its content could not be read for the policy check",
                    )),
                }
            }
            DiffShown::Text => {}
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    for (path, line, text) in added_lines(&diff.text) {
        if let Some((rule, detail)) = line_finding(&text, known) {
            if seen.insert((path.clone(), rule)) {
                findings.push(PolicyFinding::new(
                    repository_id,
                    &path,
                    rule,
                    format!("{detail} (first at line {line} of the candidate file)"),
                ));
            }
        }
    }
    findings
}

/// One line per finding for a refusal, never the content.
pub fn describe(findings: &[PolicyFinding]) -> String {
    findings
        .iter()
        .map(|finding| {
            if finding.path.is_empty() {
                format!(
                    "{} [{}]: {}",
                    finding.repository_id, finding.rule, finding.detail
                )
            } else {
                format!(
                    "{} {} [{}]: {}",
                    finding.repository_id, finding.path, finding.rule, finding.detail
                )
            }
        })
        .collect::<Vec<_>>()
        .join("; ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn credential_paths_are_recognized_and_placeholders_are_not() {
        assert!(credential_path(".env").is_some());
        assert!(credential_path("config/.env.production").is_some());
        assert!(credential_path(".env.example").is_none());
        assert!(credential_path("deploy/server.pem").is_some());
        assert!(credential_path("deploy/server.pub").is_none());
        assert!(credential_path("home/.ssh/id_ed25519").is_some());
        assert!(credential_path("docs/keys.md").is_none());
        assert!(credential_path("src/credentials.rs").is_none());
        assert!(credential_path("src/main.py").is_none());
    }

    #[test]
    fn credential_shaped_lines_are_found_and_ordinary_code_is_not() {
        let none: Vec<String> = Vec::new();
        assert!(line_finding("-----BEGIN RSA PRIVATE KEY-----", &none).is_some());
        assert!(line_finding(
            "token = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123'",
            &none
        )
        .is_some());
        assert!(line_finding("AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE1", &none).is_some());
        assert!(
            line_finding("const url = 'postgres://app:S3cr3tPassw0rd!@db/app'", &none).is_some()
        );
        assert!(line_finding("DB_PASSWORD=\"Xk9f2mQ8vL3pR7wZ\"", &none).is_some());
        assert!(line_finding(
            "auth: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig",
            &none
        )
        .is_some());
        for ordinary in [
            "print('implemented by the synthetic writer')",
            "token: string;",
            "const token = process.env.GITHUB_TOKEN;",
            "password = os.environ['DB_PASSWORD']",
            "API_KEY=<your-key-here>",
            "secret = \"${SECRET}\"",
            "if token == other_token:",
            "https://example.com/path",
            "password: changeme-please-now",
            "let github_token_name = \"GITHUB_TOKEN\";",
        ] {
            assert!(line_finding(ordinary, &none).is_none(), "{ordinary}");
        }
        // Quoted keys (JSON, YAML) and multibyte text before the key.
        assert!(line_finding("\"password\": \"Xk9f2mQ8vL3pR7wZ\",", &none).is_some());
        assert!(line_finding("  'api_key': 'Xk9f2mQ8vL3pR7wZq1'", &none).is_some());
        assert!(line_finding("// 日本語: explanation", &none).is_none());
        assert!(line_finding("ключ_token = \"Xk9f2mQ8vL3pR7wZ\"", &none).is_some());
        assert!(line_finding("名前: 値", &none).is_none());
        let known = vec!["synthetic-runtime-token-value".to_owned()];
        assert_eq!(
            line_finding("x = 'synthetic-runtime-token-value'", &known).map(|f| f.0),
            Some("known-credential")
        );
    }

    #[test]
    fn quoted_git_paths_are_decoded_before_scanning() {
        assert_eq!(unquote_git_path("b/plain.txt"), "b/plain.txt");
        assert_eq!(unquote_git_path("\"b/caf\\303\\251.txt\""), "b/café.txt");
        assert_eq!(
            unquote_git_path("\"b/say \\\"hi\\\".txt\""),
            "b/say \"hi\".txt"
        );
        let text = "diff --git \"a/caf\\303\\251.txt\" \"b/caf\\303\\251.txt\"\n--- /dev/null\n+++ \"b/caf\\303\\251.txt\"\n@@ -0,0 +1 @@\n+ghp_0123456789abcdefghijklmnopqrstuvwxyz0123\n";
        let lines = added_lines(text);
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].0, "café.txt");
        assert!(line_finding(&lines[0].2, &[]).is_some());
    }

    #[test]
    fn binary_files_are_scanned_from_their_blob_or_refused() {
        let plan: PlanRevision =
            serde_json::from_str(include_str!("../../../fixtures/domain/plan.valid.json")).unwrap();
        let repository = plan.tasks[0].repository_id.clone();
        let path = plan.tasks[0].paths[0].clone();
        let file = |shown| DiffFile {
            path: path.clone(),
            status: "A".into(),
            old_blob: "0".repeat(40),
            new_blob: "1".repeat(40),
            shown,
        };
        let diff = ReviewDiff {
            text: String::new(),
            files: vec![file(DiffShown::Summary)],
            truncated: false,
        };
        let mut secret =
            b"\0binary header\ntoken = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123'\n".to_vec();
        secret.push(0);
        let found = scan_repository(
            &repository,
            &plan,
            &diff,
            &[],
            &[BinaryContent {
                path: path.clone(),
                bytes: Some(secret),
            }],
        );
        assert!(
            found
                .iter()
                .any(|f| f.rule == "credential-token" && f.path == path),
            "{found:?}"
        );
        let clean = scan_repository(
            &repository,
            &plan,
            &diff,
            &[],
            &[BinaryContent {
                path: path.clone(),
                bytes: Some(vec![0, 1, 2, 255, 254]),
            }],
        );
        assert!(
            clean
                .iter()
                .all(|f| f.rule != "credential-token" && f.rule != "unscanned"),
            "{clean:?}"
        );
        let unread = scan_repository(&repository, &plan, &diff, &[], &[]);
        assert!(unread.iter().any(|f| f.rule == "unscanned"), "{unread:?}");
    }

    #[test]
    fn added_lines_carry_their_path_and_line_number() {
        let text = "diff --git a/src/a.py b/src/a.py\n--- a/src/a.py\n+++ b/src/a.py\n@@ -1,2 +1,3 @@\n keep\n-old\n+new one\n+new two\ndiff --git a/gone b/gone\n--- a/gone\n+++ /dev/null\n@@ -1 +0,0 @@\n-bye\n";
        let lines = added_lines(text);
        assert_eq!(
            lines,
            vec![
                ("src/a.py".to_owned(), 2, "new one".to_owned()),
                ("src/a.py".to_owned(), 3, "new two".to_owned())
            ]
        );
    }
}
