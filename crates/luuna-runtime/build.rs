//! Embeds a content-derived build identity: a SHA-256 over every file compiled
//! into the runtime (each crate's manifest, `build.rs`, `src/` and `assets/`,
//! plus the workspace manifest and lockfile). `/health` reports it so evidence
//! can be bound to the exact sources a binary was built from, independent of
//! timestamps. `scripts/m3-smoke.mjs` computes the same digest. The compiler
//! that built the binary is embedded too (`build_rustc`), so evidence can be
//! checked against the toolchain pinned in `rust-toolchain.toml`.

use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

fn collect(root: &Path, dir: &Path, files: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        let path = entry.path();
        if kind.is_dir() {
            collect(root, &path, files);
        } else if kind.is_file() {
            files.push(relative(root, &path));
        }
    }
}

/// Whether Cargo config text changes what or how the runtime is built beyond
/// the repository's own manifests: a `paths` dependency override, a `[patch…]`
/// table, a source `replace-with`, a `[profile…]` table (overflow checks, panic
/// strategy, LTO, ...) or an `include` of further config that is not read here.
fn config_override(text: &str) -> bool {
    let key = |line: &str, name: &str| {
        line.strip_prefix(name)
            .is_some_and(|rest| rest.trim_start().starts_with('='))
    };
    text.lines().map(str::trim).any(|line| {
        key(line, "paths")
            || key(line, "include")
            || key(line, "replace-with")
            || line.starts_with("[patch")
            || line.starts_with("[profile")
            || line.starts_with("profile.")
            || line.starts_with("patch.")
    })
}

fn relative(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).expect("input inside the workspace");
    rel.components()
        .map(|part| part.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn main() {
    let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").expect("manifest dir"))
        .join("..")
        .join("..");
    let root = root.canonicalize().expect("workspace root");
    let mut files = Vec::new();
    for name in ["Cargo.toml", "Cargo.lock"] {
        files.push(name.to_owned());
        println!("cargo:rerun-if-changed={}", root.join(name).display());
    }
    let crates = root.join("crates");
    println!("cargo:rerun-if-changed={}", crates.display());
    let mut members: Vec<PathBuf> = fs::read_dir(&crates)
        .expect("crates directory")
        .flatten()
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .collect();
    members.sort();
    for member in members {
        for file in ["Cargo.toml", "build.rs"] {
            let path = member.join(file);
            if fs::symlink_metadata(&path)
                .map(|m| m.is_file())
                .unwrap_or(false)
            {
                files.push(relative(&root, &path));
            }
            println!("cargo:rerun-if-changed={}", path.display());
        }
        for dir in ["src", "assets"] {
            let path = member.join(dir);
            collect(&root, &path, &mut files);
            println!("cargo:rerun-if-changed={}", path.display());
        }
    }
    files.sort();
    let mut digest = Sha256::new();
    for file in &files {
        let content = fs::read(root.join(file)).expect("readable build input");
        let hex: String = Sha256::digest(&content)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
        digest.update(format!("{file}\0{hex}\n").as_bytes());
    }
    let identity: String = digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    println!("cargo:rustc-env=LUUNA_BUILD_IDENTITY=sha256:{identity}");
    // The compiler Cargo actually invokes for this build, not whatever is on PATH.
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_owned());
    let version = std::process::Command::new(rustc)
        .arg("-vV")
        .output()
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .unwrap_or_default();
    let field = |key: &str| {
        version
            .lines()
            .find_map(|line| line.strip_prefix(key))
            .map(str::trim)
            .unwrap_or("unknown")
            .to_owned()
    };
    println!(
        "cargo:rustc-env=LUUNA_BUILD_RUSTC={} ({})",
        field("release:"),
        field("commit-hash:")
    );
    // Cargo runs any configured wrapper around RUSTC (environment or config);
    // it can change how the binary is compiled, so it is reported, not hidden.
    let wrappers: Vec<String> = ["RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER"]
        .iter()
        .filter_map(|name| {
            println!("cargo:rerun-if-env-changed={name}");
            std::env::var(name)
                .ok()
                .filter(|value| !value.is_empty())
                .map(|value| format!("{name}={value}"))
        })
        .collect();
    let wrappers = if wrappers.is_empty() {
        "none".to_owned()
    } else {
        wrappers.join(" ")
    };
    println!("cargo:rustc-env=LUUNA_BUILD_RUSTC_WRAPPER={wrappers}");
    // Flags and profile settings change the compiled behavior without changing
    // the sources or the compiler, so they are reported too: the effective
    // RUSTFLAGS (Cargo encodes the environment and config sources into
    // CARGO_ENCODED_RUSTFLAGS), the profile's optimization and debug
    // settings, and the names of any profile or build
    // overrides set in the environment.
    for name in ["CARGO_ENCODED_RUSTFLAGS", "RUSTFLAGS"] {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let rustflags = std::env::var("CARGO_ENCODED_RUSTFLAGS")
        .unwrap_or_default()
        .split('\u{1f}')
        .filter(|flag| !flag.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    let mut overrides: Vec<String> = std::env::vars()
        .map(|(name, _)| name)
        .filter(|name| {
            name.starts_with("CARGO_PROFILE_")
                || (name.starts_with("CARGO_TARGET_") && name.ends_with("_RUSTFLAGS"))
                || name == "CARGO_BUILD_RUSTFLAGS"
        })
        .collect();
    overrides.sort();
    for name in &overrides {
        println!("cargo:rerun-if-env-changed={name}");
    }
    let value = |name: &str| std::env::var(name).unwrap_or_else(|_| "unknown".to_owned());
    // Cargo config can substitute dependency sources without touching the
    // lockfile (`paths` overrides) or redirect them (`[patch]`, source
    // `replace-with`); the config files Cargo reads for this workspace are
    // checked and any that declare such an override are named.
    println!("cargo:rerun-if-env-changed=CARGO_HOME");
    let mut candidates = Vec::new();
    let mut dir = Some(root.as_path());
    while let Some(current) = dir {
        candidates.push(current.join(".cargo").join("config"));
        candidates.push(current.join(".cargo").join("config.toml"));
        dir = current.parent();
    }
    if let Some(home) = std::env::var_os("CARGO_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".cargo")))
    {
        candidates.push(home.join("config"));
        candidates.push(home.join("config.toml"));
    }
    let dependency_overrides: Vec<String> = candidates
        .iter()
        .filter_map(|path| {
            let text = fs::read_to_string(path).ok()?;
            println!("cargo:rerun-if-changed={}", path.display());
            config_override(&text).then(|| path.display().to_string())
        })
        .collect();
    println!(
        "cargo:rustc-env=LUUNA_BUILD_FLAGS=profile={} opt-level={} debug={} rustflags={} overrides={} config-overrides={}",
        value("PROFILE"),
        value("OPT_LEVEL"),
        value("DEBUG"),
        if rustflags.is_empty() { "none".to_owned() } else { rustflags.replace(' ', ",") },
        if overrides.is_empty() { "none".to_owned() } else { overrides.join(",") },
        if dependency_overrides.is_empty() { "none".to_owned() } else { dependency_overrides.join(",") },
    );
}
