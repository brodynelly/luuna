//! Short references (ADR 0042). The runtime names records with generated identities such as
//! `ticket-3f2a91c0-…`, `plan-ticket-3f2a91c0-…` and `workflow-8b1e…`; nobody should have to copy
//! one whole. Lists show each record's short id (the first eight hex digits of its generated UUID),
//! and every ticket, plan, run and memory argument accepts that short id, any unique prefix of at
//! least four hex digits, the full id or (for runs) `latest`. A plan shares its ticket's short id.
//!
//! Resolution is presentation only: the client reads the same lists any developer could, picks
//! the one record the reference names, and sends that record's exact identity. An ambiguous or
//! unknown reference is refused before anything is sent. Hash acknowledgments (plans, candidates,
//! memory content) accept a prefix of at least eight hex digits that must match the record the
//! command just read; the exact full hash is still what reaches the runtime.
use crate::client::{encode_component, Client, Signal};
use crate::commands::{Command, FlagValue, Input};
use crate::failures::Failure;
use crate::js::J;

/// Hex digits a prefix needs before it can name a record.
pub const MIN_ID_PREFIX: usize = 4;
/// Hex digits a hash prefix needs before it can acknowledge a hash.
pub const MIN_HASH_PREFIX: usize = 8;
/// Prefixes the runtime puts before generated UUIDs; a reference may repeat them.
const KINDS: &[&str] = &[
    "plan-ticket-",
    "ticket-",
    "plan-",
    "workflow-",
    "mem-",
    "run-",
    "#",
];

fn hex(text: &str) -> bool {
    !text.is_empty() && text.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The first generated UUID (8-4-4-4-12 hex digits) inside an id, lowercased.
fn uuid_in(id: &str) -> Option<String> {
    let lower = id.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    (0..bytes.len()).find_map(|start| {
        let candidate = lower.get(start..start + 36)?;
        let groups: Vec<&str> = candidate.split('-').collect();
        let shape = groups.len() == 5
            && groups.iter().map(|g| g.len()).eq([8, 4, 4, 4, 12])
            && groups.iter().all(|g| hex(g));
        let bounded = start == 0 || bytes[start - 1] == b'-';
        (shape && bounded).then(|| candidate.to_string())
    })
}

/// The short id lists show: the first eight hex digits of the id's UUID, else the id itself.
pub fn short_id(id: &str) -> String {
    uuid_in(id)
        .map(|u| u[..8].to_string())
        .unwrap_or_else(|| id.to_string())
}

/// `sha256:` and the first twelve hex digits, for display beside the complete hash; anything else
/// (not a hex digest) is shown whole, as `@luuna/ui`'s `shortHash` does.
pub fn short_hash(hash: &str) -> String {
    match hash.strip_prefix("sha256:") {
        Some(digits) if digits.len() > 12 && hex(digits) => format!("sha256:{}", &digits[..12]),
        _ => hash.to_string(),
    }
}

/// The hex part of a reference after any kind prefix, when it is shaped like a short reference
/// (hex digits and dashes, at least four digits, not already a complete UUID).
fn reference(text: &str) -> Option<String> {
    let trimmed = text.trim().to_ascii_lowercase();
    let mut rest = trimmed.as_str();
    for kind in KINDS {
        if let Some(stripped) = rest.strip_prefix(kind) {
            rest = stripped;
            break;
        }
    }
    let digits = rest.bytes().filter(u8::is_ascii_hexdigit).count();
    let shaped = !rest.is_empty()
        && rest.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        && !rest.starts_with('-')
        && digits >= MIN_ID_PREFIX
        && uuid_in(rest).is_none();
    shaped.then(|| rest.to_string())
}

/// Whether an argument is a short reference this module resolves (else it passes through).
pub fn is_short_reference(text: &str) -> bool {
    reference(text).is_some()
}

/// The kind of record a reference's own prefix names (`ticket-3f2a` names a ticket), if any.
fn named_kind(text: &str) -> Option<&'static str> {
    let lower = text.trim().to_ascii_lowercase();
    [
        ("plan-", "plan"),
        ("ticket-", "ticket"),
        ("workflow-", "run"),
        ("run-", "run"),
        ("mem-", "memory record"),
    ]
    .into_iter()
    .find(|(prefix, _)| lower.starts_with(prefix))
    .map(|(_, kind)| kind)
}

/// Whether a reference's own prefix, if it has one, names one of the `allowed` kinds.
pub fn kind_matches(text: &str, allowed: &[&str]) -> bool {
    named_kind(text).is_none_or(|kind| allowed.contains(&kind))
}

/// Refuses a reference whose prefix names another kind of record than the argument takes, so
/// `cancel ticket-3f2a` never cancels a run whose id happens to begin `3f2a`.
fn same_kind(text: &str, expected: &str, allowed: &[&str]) -> Result<(), Failure> {
    match named_kind(text) {
        Some(kind) if !allowed.contains(&kind) => Err(Failure::Refusal(format!(
            "{} names a {kind}, not a {expected}.",
            text.trim()
        ))),
        _ => Ok(()),
    }
}

fn named_by(id: &str, prefix: &str) -> bool {
    uuid_in(id).is_some_and(|u| u.starts_with(prefix))
}

/// The one id among `ids` that a reference names (exactly, or by a unique short-id prefix).
pub fn unique_match(text: &str, ids: &[String]) -> Option<String> {
    if let Some(exact) = ids.iter().find(|id| id.as_str() == text) {
        return Some(exact.clone());
    }
    let prefix = reference(text)?;
    let mut matched = ids.iter().filter(|id| named_by(id, &prefix));
    match (matched.next(), matched.next()) {
        (Some(one), None) => Some(one.clone()),
        _ => None,
    }
}

/// The one record a reference names, or a refusal listing what it matched.
fn pick<'a>(
    kind: &str,
    text: &str,
    records: &'a [J],
    label: impl Fn(&J) -> String,
) -> Result<&'a J, Failure> {
    let id = |r: &J| r.get("id").as_str().unwrap_or("").to_string();
    if let Some(exact) = records.iter().find(|r| id(r) == text) {
        return Ok(exact);
    }
    let Some(prefix) = reference(text) else {
        return Err(Failure::Refusal(format!("No {kind} is named {text}.")));
    };
    let matched: Vec<&J> = records
        .iter()
        .filter(|r| named_by(&id(r), &prefix))
        .collect();
    match matched.as_slice() {
        [one] => Ok(one),
        [] => Err(Failure::Refusal(format!(
            "No {kind} has the short id {text}. List them to see each short id."
        ))),
        many => Err(Failure::Refusal(format!(
            "{text} matches {} {kind}s; type more of the id: {}",
            many.len(),
            many.iter()
                .take(6)
                .map(|r| format!("{} {}", short_id(&id(r)), label(r)))
                .collect::<Vec<_>>()
                .join(" · ")
        ))),
    }
}

fn records(value: J) -> Vec<J> {
    match value {
        J::Arr(items) => items,
        other => other.get("runs").as_arr().cloned().unwrap_or_default(),
    }
}

async fn tickets(client: &Client, signal: &Signal) -> Result<Vec<J>, Failure> {
    let projects = records(client.get("/projects", signal).await?);
    let mut all = Vec::new();
    for project in projects {
        let id = project.get("id").js();
        let listed = client
            .get(
                &format!("/projects/{}/tickets", encode_component(&id)),
                signal,
            )
            .await?;
        all.extend(records(listed));
    }
    Ok(all)
}

fn title(record: &J) -> String {
    let text = record.get("title").as_str().unwrap_or("").to_string();
    if text.chars().count() > 40 {
        format!("{}…", text.chars().take(39).collect::<String>())
    } else {
        text
    }
}

async fn ticket_id(client: &Client, text: &str, signal: &Signal) -> Result<String, Failure> {
    let all = tickets(client, signal).await?;
    Ok(pick("ticket", text, &all, title)?.get("id").js())
}

async fn run_id(client: &Client, text: &str, signal: &Signal) -> Result<String, Failure> {
    let all = records(client.get("/runs", signal).await?);
    if text.trim().eq_ignore_ascii_case("latest") {
        let newest = all
            .iter()
            .max_by(|a, b| a.get("created_at").js().cmp(&b.get("created_at").js()))
            .ok_or_else(|| Failure::Refusal("No runs are recorded yet.".into()))?;
        return Ok(newest.get("id").js());
    }
    let label = |r: &J| {
        let kind = r
            .get("metadata")
            .get("kind")
            .as_str()
            .unwrap_or("session")
            .to_string();
        format!("{kind} {}", r.get("state").js())
    };
    Ok(pick("run", text, &all, label)?.get("id").js())
}

fn memory_label(record: &J) -> String {
    let content = record.get("content").as_str().unwrap_or("").to_string();
    content.chars().take(40).collect()
}

async fn memory(client: &Client, project: &str, signal: &Signal) -> Result<Vec<J>, Failure> {
    let path = format!(
        "/projects/{}/memory?include_user=true",
        encode_component(project)
    );
    Ok(records(client.get(&path, signal).await?))
}

/// A hash a developer acknowledged by its prefix: the complete hash when the prefix (with or
/// without `sha256:`, at least eight hex digits) begins it; otherwise the text unchanged, so the
/// caller's exact comparison refuses it.
pub fn complete_hash(typed: &str, hash: &str) -> String {
    let typed = typed.trim().to_ascii_lowercase();
    let digits = typed.strip_prefix("sha256:").unwrap_or(&typed);
    let full = hash.strip_prefix("sha256:").unwrap_or(hash);
    if hash.starts_with("sha256:")
        && digits.len() >= MIN_HASH_PREFIX
        && hex(digits)
        && full.starts_with(digits)
    {
        hash.to_string()
    } else {
        typed
    }
}

/// The command's input with each short reference replaced by the exact identity it names.
/// Arguments that already look exact (or are not shaped like a reference) pass through untouched,
/// so nothing extra is read for them.
pub async fn resolve(
    command: &Command,
    client: &Client,
    input: &Input,
    signal: &Signal,
) -> Result<Input, Failure> {
    let mut resolved = input.clone();
    let first = input.args.first().cloned().unwrap_or_default();
    let latest = first.trim().eq_ignore_ascii_case("latest");
    match command.context.as_str() {
        "ticket" if is_short_reference(&first) => {
            same_kind(&first, "ticket", &["ticket"])?;
            resolved.args[0] = ticket_id(client, &first, signal).await?;
        }
        // A plan's short id is its ticket's.
        "plan" if is_short_reference(&first) => {
            same_kind(&first, "plan", &["plan", "ticket"])?;
            let ticket = ticket_id(client, &first, signal).await?;
            resolved.args[0] = format!("plan-{ticket}");
        }
        "run" if latest || is_short_reference(&first) => {
            same_kind(&first, "run", &["run"])?;
            resolved.args[0] = run_id(client, &first, signal).await?;
        }
        _ => {}
    }
    // Lists print short ids, so the flags that take a run or memory id accept them too.
    if command.id == "runs.list" {
        let named = |b: &String| is_short_reference(b) || b.trim().eq_ignore_ascii_case("latest");
        if let Some(before) = input.text_if("before").filter(named) {
            same_kind(&before, "run", &["run"])?;
            let exact = run_id(client, &before, signal).await?;
            resolved.set("before", FlagValue::Str(exact));
        }
    }
    let selected = input.list("memory");
    if command.id == "plans.create" && selected.iter().any(|id| is_short_reference(id)) {
        let ticket = client
            .get(
                &format!("/tickets/{}", encode_component(&resolved.args[0])),
                signal,
            )
            .await?;
        let all = memory(client, &ticket.get("project_id").js(), signal).await?;
        let mut exact = Vec::new();
        for id in &selected {
            if is_short_reference(id) {
                same_kind(id, "memory record", &["memory record"])?;
                exact.push(
                    pick("memory record", id, &all, memory_label)?
                        .get("id")
                        .js(),
                );
            } else {
                exact.push(id.clone());
            }
        }
        resolved.set("memory", FlagValue::List(exact));
    }
    if matches!(
        command.name.as_str(),
        "forget" | "promote" | "correct-memory"
    ) && input.args.len() >= 3
    {
        let (id, hash) = (&input.args[1], &input.args[2]);
        let short_hash = !hash.trim().starts_with("sha256:") || hash.trim().len() < 71;
        if is_short_reference(id) || short_hash {
            same_kind(id, "memory record", &["memory record"])?;
            let all = memory(client, &input.args[0], signal).await?;
            let record = pick("memory record", id, &all, memory_label)?;
            resolved.args[1] = record.get("id").js();
            resolved.args[2] = complete_hash(hash, &record.get("hash").js());
        }
    }
    Ok(resolved)
}

#[cfg(test)]
mod tests {
    use super::*;
    const T: &str = "ticket-3f2a91c0-1b2c-4d5e-8f90-0123456789ab";

    #[test]
    fn a_hash_is_shortened_only_when_it_is_a_hex_digest() {
        let full = format!("sha256:{}", "ab".repeat(32));
        assert_eq!(short_hash(&full), "sha256:abababababab");
        assert_eq!(short_hash("sha256:abc"), "sha256:abc");
        assert_eq!(
            short_hash("sha256:aééééééé"),
            "sha256:aééééééé",
            "never panics"
        );
        assert_eq!(short_hash("sha256:zzzzzzzzzzzzzz"), "sha256:zzzzzzzzzzzzzz");
    }

    #[test]
    fn a_prefix_naming_another_kind_is_refused() {
        assert!(same_kind("ticket-3f2a", "run", &["run"]).is_err());
        assert!(same_kind("workflow-3f2a", "run", &["run"]).is_ok());
        assert!(same_kind("#3f2a", "run", &["run"]).is_ok());
        assert!(same_kind("3f2a", "run", &["run"]).is_ok());
        assert!(same_kind("ticket-3f2a", "plan", &["plan", "ticket"]).is_ok());
        assert!(same_kind("plan-ticket-3f2a", "plan", &["plan", "ticket"]).is_ok());
        assert!(same_kind("mem-3f2a", "ticket", &["ticket"]).is_err());
    }

    #[test]
    fn short_ids_come_from_the_generated_uuid() {
        assert_eq!(short_id(T), "3f2a91c0");
        assert_eq!(short_id(&format!("plan-{T}")), "3f2a91c0");
        assert_eq!(short_id("walkthrough"), "walkthrough");
        assert_eq!(short_id("plan-1"), "plan-1");
    }

    #[test]
    fn only_reference_shaped_text_is_resolved() {
        for yes in [
            "3f2a",
            "3F2A91C0",
            "ticket-3f2a",
            "plan-3f2a91",
            "#3f2a91c0",
            "3f2a91c0-1b2c",
        ] {
            assert!(is_short_reference(yes), "{yes}");
        }
        for no in [
            "t",
            "plan-1",
            "run-1",
            "abc",
            "walkthrough",
            T,
            "latest",
            "",
            "-3f2a",
        ] {
            assert!(!is_short_reference(no), "{no}");
        }
    }

    #[test]
    fn a_reference_picks_one_record_or_refuses() {
        let records = vec![
            crate::js::parse(&format!(r#"{{"id":"{T}","title":"Greeting"}}"#)).unwrap(),
            crate::js::parse(
                r#"{"id":"ticket-3f2b0000-1b2c-4d5e-8f90-0123456789ab","title":"Other"}"#,
            )
            .unwrap(),
        ];
        assert_eq!(
            pick("ticket", "3f2a", &records, title)
                .unwrap()
                .get("id")
                .js(),
            T
        );
        assert_eq!(
            pick("ticket", T, &records, title).unwrap().get("id").js(),
            T
        );
        let ambiguous = pick("ticket", "3f2c", &records, title)
            .map(|_| ())
            .unwrap_err()
            .message();
        assert!(ambiguous.contains("No ticket"), "{ambiguous}");
        let many = pick("ticket", "3f2", &records, title)
            .map(|_| ())
            .unwrap_err()
            .message();
        assert!(
            many.contains("No ticket is named"),
            "three digits are too few: {many}"
        );
        let both = vec![records[0].clone(), records[0].clone()];
        let two = pick("ticket", "3f2a", &both, title)
            .map(|_| ())
            .unwrap_err()
            .message();
        assert!(
            two.contains("matches 2 tickets") && two.contains("3f2a91c0 Greeting"),
            "{two}"
        );
    }

    #[test]
    fn a_hash_prefix_completes_only_the_hash_it_begins() {
        let hash = format!("sha256:{}", "ab12".repeat(16));
        assert_eq!(complete_hash("ab12ab12", &hash), hash);
        assert_eq!(complete_hash("sha256:AB12AB12AB", &hash), hash);
        assert_eq!(complete_hash(&hash, &hash), hash);
        assert_eq!(
            complete_hash("ab12ab1", &hash),
            "ab12ab1",
            "seven digits are too few"
        );
        assert_eq!(complete_hash("ffffffff", &hash), "ffffffff");
        assert_eq!(short_hash(&hash), "sha256:ab12ab12ab12");
    }
}
