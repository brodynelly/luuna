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
}
