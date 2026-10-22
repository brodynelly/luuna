//! Relationship proposals between a project's registered repositories (M4).
//!
//! Evidence is read from the same bounded manifest files discovery already
//! reads: a `package.json` whose `dependencies` or `devDependencies` name
//! another repository's package `name`, a `Cargo.toml` whose `path`
//! dependencies resolve to another repository's root, and a `go.mod` whose
//! `replace` directives point by relative path into another repository. Each
//! proposal is a `package` relationship from the producer (the repository
//! depended on) to the consumer, carries `confirmed: false` and evidence
//! strings, and authorizes nothing: the developer confirms or removes it
//! before the manifest is confirmed. Nothing here executes repository text.
use luuna_domain::{Relationship, RelationshipKind};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
};

/// Propose relationships between the given repositories (`(id, root)`).
/// Deterministic: ordered by producer, consumer and contract, deduplicated.
pub fn propose(repositories: &[(String, PathBuf)]) -> Vec<Relationship> {
    let canonical: Vec<(String, PathBuf, PathBuf)> = repositories
        .iter()
        .map(|(id, root)| {
            (
                id.clone(),
                root.clone(),
                root.canonicalize().unwrap_or_else(|_| root.clone()),
            )
        })
        .collect();
    let mut proposals: Vec<Relationship> = Vec::new();
    for (consumer, root, _) in &canonical {
        let producers_by_name =
            |name: &str, manifest: &str, field: &str, read: &dyn Fn(&Path) -> Option<String>| {
                canonical
                    .iter()
                    .filter(|(producer, _, _)| producer != consumer)
                    .filter_map(|(producer, producer_root, _)| {
                        let declared = read(producer_root)?;
                        (declared == name).then(|| {
                            (
                                producer.clone(),
                                format!(
                                    "{consumer}/{manifest} {field} names \"{name}\", the package name declared by {producer}/{manifest}"
                                ),
                            )
                        })
                    })
                    .collect::<Vec<_>>()
            };
        // package.json: dependencies and devDependencies by package name.
        if let Some(package) = read_json(root, "package.json") {
            for field in ["dependencies", "devDependencies"] {
                let Some(dependencies) = package.get(field).and_then(|v| v.as_object()) else {
                    continue;
                };
                for name in dependencies.keys() {
                    for (producer, evidence) in
                        producers_by_name(name, "package.json", field, &node_package_name)
                    {
                        proposals.push(relationship(
                            &producer,
                            consumer,
                            format!("npm:{name}"),
                            evidence,
                        ));
                    }
                }
            }
        }
        // Cargo.toml: dependencies with a `path` that resolves to another root.
        if let Some(cargo) = read_text(root, "Cargo.toml") {
            for (table, name, path) in cargo_path_dependencies(&cargo) {
                let Some(producer) = repository_at(&canonical, consumer, root, &path) else {
                    continue;
                };
                proposals.push(relationship(
                    &producer,
                    consumer,
                    format!("cargo:{name}"),
                    format!(
                        "{consumer}/Cargo.toml [{table}] {name} has path = \"{path}\", which resolves to the root of {producer}"
                    ),
                ));
            }
        }
        // go.mod: replace directives with a relative path into another root.
        if let Some(gomod) = read_text(root, "go.mod") {
            for (module, path) in go_replace_paths(&gomod) {
                let Some(producer) = repository_at(&canonical, consumer, root, &path) else {
                    continue;
                };
                proposals.push(relationship(
                    &producer,
                    consumer,
                    format!("go:{module}"),
                    format!(
                        "{consumer}/go.mod replaces {module} => {path}, which resolves to the root of {producer}"
                    ),
                ));
            }
        }
    }
    proposals.sort_by(|a, b| {
        (&a.producer, &a.consumer, &a.contract).cmp(&(&b.producer, &b.consumer, &b.contract))
    });
    let mut seen = BTreeSet::new();
    proposals.retain(|r| seen.insert((r.producer.clone(), r.consumer.clone(), r.contract.clone())));
    proposals
}

fn relationship(
    producer: &str,
    consumer: &str,
    contract: String,
    evidence: String,
) -> Relationship {
    Relationship {
        producer: producer.to_owned(),
        consumer: consumer.to_owned(),
        kind: RelationshipKind::Package,
        contract,
        confirmed: false,
        evidence: vec![evidence],
    }
}

/// The repository whose canonical root is `root/<relative>`, if any other.
fn repository_at(
    repositories: &[(String, PathBuf, PathBuf)],
    consumer: &str,
    root: &Path,
    relative: &str,
) -> Option<String> {
    if relative.is_empty() || Path::new(relative).is_absolute() {
        return None;
    }
    let target = root.join(relative).canonicalize().ok()?;
    repositories
        .iter()
        .find(|(id, _, canonical)| id != consumer && *canonical == target)
        .map(|(id, _, _)| id.clone())
}

fn read_text(root: &Path, name: &str) -> Option<String> {
    let path = root.join(name);
    let metadata = std::fs::symlink_metadata(&path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > crate::MAX_MANIFEST_FILE_BYTES {
        return None;
    }
    std::fs::read_to_string(path).ok()
}

fn read_json(root: &Path, name: &str) -> Option<serde_json::Value> {
    serde_json::from_str(&read_text(root, name)?).ok()
}

fn node_package_name(root: &Path) -> Option<String> {
    read_json(root, "package.json")?
        .get("name")?
        .as_str()
        .map(ToOwned::to_owned)
}

/// `(table, dependency name, path)` for every `path = "…"` dependency in a
/// Cargo manifest's `[dependencies]`, `[dev-dependencies]`,
/// `[build-dependencies]`, `[workspace.dependencies]` and their
/// `[<table>.<name>]` sub-tables. A bounded line parser: inline tables
/// (`name = { path = "../x", … }`) and dotted sub-tables are recognised;
/// anything else is ignored rather than guessed.
fn cargo_path_dependencies(text: &str) -> Vec<(String, String, String)> {
    const TABLES: [&str; 4] = [
        "dependencies",
        "dev-dependencies",
        "build-dependencies",
        "workspace.dependencies",
    ];
    let mut found = Vec::new();
    // The dependency table we are in, and the dependency name when the
    // current section is a `[<table>.<name>]` sub-table.
    let mut section: Option<(String, Option<String>)> = None;
    for raw in text.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        if let Some(header) = line.strip_prefix('[').and_then(|l| l.strip_suffix(']')) {
            let header = header.trim();
            section = TABLES.iter().find_map(|table| {
                if header == *table {
                    Some(((*table).to_owned(), None))
                } else {
                    header
                        .strip_prefix(table)
                        .and_then(|rest| rest.strip_prefix('.'))
                        .filter(|name| !name.is_empty() && !name.contains('.'))
                        .map(|name| ((*table).to_owned(), Some(unquote(name))))
                }
            });
            continue;
        }
        let Some((table, sub_table)) = &section else {
            continue;
        };
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let (key, value) = (unquote(key.trim()), value.trim());
        match sub_table {
            Some(name) if key == "path" => {
                if let Some(path) = quoted(value) {
                    found.push((table.clone(), name.clone(), path));
                }
            }
            None if value.starts_with('{') => {
                if let Some(path) = inline_table_value(value, "path") {
                    found.push((table.clone(), key, path));
                }
            }
            _ => {}
        }
    }
    found
}

/// `(module, relative path)` for every `replace <module> [version] => <path>`
/// directive of a `go.mod`, single-line or inside a `replace (…)` block, whose
/// target is a filesystem path rather than a module version.
fn go_replace_paths(text: &str) -> Vec<(String, String)> {
    let mut found = Vec::new();
    let mut in_block = false;
    for raw in text.lines() {
        let line = raw.split("//").next().unwrap_or("").trim();
        if line.is_empty() {
            continue;
        }
        let directive = if in_block {
            if line == ")" {
                in_block = false;
                continue;
            }
            line
        } else if let Some(rest) = line.strip_prefix("replace") {
            let rest = rest.trim();
            if rest == "(" {
                in_block = true;
                continue;
            }
            rest
        } else {
            continue;
        };
        let Some((left, right)) = directive.split_once("=>") else {
            continue;
        };
        let module = left.split_whitespace().next().unwrap_or("").to_owned();
        let target: Vec<&str> = right.split_whitespace().collect();
        // A path target has no version after it; module targets do.
        if module.is_empty() || target.len() != 1 {
            continue;
        }
        let path = unquote(target[0]);
        if path.starts_with("./") || path.starts_with("../") || path == "." || path == ".." {
            found.push((module, path));
        }
    }
    found
}

fn inline_table_value(table: &str, wanted: &str) -> Option<String> {
    let inner = table.strip_prefix('{')?.rsplit_once('}')?.0;
    inner.split(',').find_map(|entry| {
        let (key, value) = entry.split_once('=')?;
        (key.trim() == wanted)
            .then(|| quoted(value.trim()))
            .flatten()
    })
}

fn quoted(value: &str) -> Option<String> {
    let value = value.trim();
    let inner = value
        .strip_prefix('"')
        .and_then(|v| v.strip_suffix('"'))
        .or_else(|| value.strip_prefix('\'').and_then(|v| v.strip_suffix('\'')))?;
    Some(inner.to_owned())
}

fn unquote(value: &str) -> String {
    quoted(value).unwrap_or_else(|| value.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo(root: &Path, id: &str) -> (String, PathBuf) {
        let path = root.join(id);
        std::fs::create_dir_all(&path).unwrap();
        (id.to_owned(), path)
    }

    #[test]
    fn package_json_dependencies_name_another_repository_package() {
        let dir = tempfile::tempdir().unwrap();
        let api = repo(dir.path(), "api");
        let shared = repo(dir.path(), "shared");
        let consumer = repo(dir.path(), "consumer");
        std::fs::write(
            api.1.join("package.json"),
            r#"{"name": "@acme/api", "version": "1.0.0"}"#,
        )
        .unwrap();
        std::fs::write(
            shared.1.join("package.json"),
            r#"{"name": "@acme/shared", "dependencies": {"@acme/api": "workspace:*", "left-pad": "1"}}"#,
        )
        .unwrap();
        std::fs::write(
            consumer.1.join("package.json"),
            r#"{"name": "consumer", "devDependencies": {"@acme/shared": "^1"}}"#,
        )
        .unwrap();
        let proposed = propose(&[api, shared, consumer]);
        let edges: Vec<(&str, &str, &str)> = proposed
            .iter()
            .map(|r| {
                (
                    r.producer.as_str(),
                    r.consumer.as_str(),
                    r.contract.as_str(),
                )
            })
            .collect();
        assert_eq!(
            edges,
            [
                ("api", "shared", "npm:@acme/api"),
                ("shared", "consumer", "npm:@acme/shared")
            ]
        );
        assert!(proposed.iter().all(|r| !r.confirmed));
        assert!(proposed
            .iter()
            .all(|r| r.kind == RelationshipKind::Package && !r.evidence.is_empty()));
        assert!(proposed[1].evidence[0].contains("consumer/package.json devDependencies"));
        // The proposal is reported, never confirmed: a manifest carrying it
        // still validates, and the domain lists it for confirmation.
        let mut manifest: luuna_domain::ProjectManifest =
            serde_json::from_str(include_str!("../../../examples/project.json")).unwrap();
        manifest.relationships = vec![Relationship {
            producer: manifest.repositories[0].id.clone(),
            consumer: manifest.repositories[1].id.clone(),
            ..proposed[0].clone()
        }];
        manifest.validate().unwrap();
        assert_eq!(manifest.unconfirmed_relationships().len(), 1);
    }

    #[test]
    fn cargo_path_and_go_replace_dependencies_resolve_to_repository_roots() {
        let dir = tempfile::tempdir().unwrap();
        let core = repo(dir.path(), "core");
        let app = repo(dir.path(), "app");
        let tool = repo(dir.path(), "tool");
        std::fs::write(core.1.join("Cargo.toml"), "[package]\nname = \"core\"\n").unwrap();
        std::fs::write(
            app.1.join("Cargo.toml"),
            "[package]\nname = \"app\"\n\n[dependencies]\ncore = { path = \"../core\", features = [\"x\"] } # local\nserde = \"1\"\n\n[dev-dependencies.tool]\npath = \"../tool\"\n\n[build-dependencies]\nelsewhere = { path = \"../nowhere\" }\n",
        )
        .unwrap();
        std::fs::write(
            tool.1.join("go.mod"),
            "module example.com/tool\n\ngo 1.22\n\nreplace example.com/core => ../core\n\nreplace (\n\texample.com/app v0.0.0 => ../app\n\texample.com/other => example.com/other v1.2.3\n)\n",
        )
        .unwrap();
        let proposed = propose(&[core, app, tool]);
        let edges: Vec<(&str, &str, &str)> = proposed
            .iter()
            .map(|r| {
                (
                    r.producer.as_str(),
                    r.consumer.as_str(),
                    r.contract.as_str(),
                )
            })
            .collect();
        assert_eq!(
            edges,
            [
                ("app", "tool", "go:example.com/app"),
                ("core", "app", "cargo:core"),
                ("core", "tool", "go:example.com/core"),
                ("tool", "app", "cargo:tool"),
            ],
            "{proposed:?}"
        );
        assert!(proposed[1].evidence[0].contains("[dependencies] core has path = \"../core\""));
        assert!(proposed[3].evidence[0].contains("[dev-dependencies] tool"));
        // A path outside every registered repository proposes nothing, and a
        // repository without manifests proposes nothing.
        assert!(!proposed.iter().any(|r| r.contract == "cargo:elsewhere"));
        assert!(propose(&[repo(dir.path(), "empty")]).is_empty());
    }
}
