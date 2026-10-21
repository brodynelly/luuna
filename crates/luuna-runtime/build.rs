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

/// Collects the regular files under `dir`. Anything else (a symlink, whose
/// target Cargo would follow but the digest could not bind, or a special
/// file) is recorded in `unbound`, which makes the identity fail closed.
fn collect(root: &Path, dir: &Path, files: &mut Vec<String>, unbound: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => collect(root, &path, files, unbound),
            Ok(kind) if kind.is_file() => files.push(relative(root, &path)),
            _ => unbound.push(relative(root, &path)),
        }
    }
}

/// Whether Cargo config text may change what or how the runtime is built
/// beyond the repository's own manifests: a `paths` dependency override, a
/// `patch` table, a source `replace-with`, a `profile` setting (overflow
/// checks, panic strategy, LTO, ...) or an `include` of further config that is
/// not read here, a `rustc` compiler or `linker` substitution, or an `env`
/// table that sets variables for every build script. TOML can
/// spell these keys as table headers, dotted keys, inline tables or quoted
/// keys, so the rule is lexical and fails closed: the
/// text is flagged if any of these names appears as a whole key token
/// anywhere, or if it contains a backslash (an escape in a quoted key can
/// spell any name). A comment or value that mentions a name is flagged too.
fn config_override(text: &str) -> bool {
    let key_char = |c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-';
    text.contains('\\')
        || [
            "paths",
            "include",
            "replace-with",
            "patch",
            "profile",
            "rustc",
            "linker",
            "env",
        ]
        .iter()
        .any(|name| {
            text.match_indices(name).any(|(at, _)| {
                !text[..at].chars().next_back().is_some_and(key_char)
                    && !text[at + name.len()..].chars().next().is_some_and(key_char)
            })
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
    let mut unbound = Vec::new();
    for name in ["Cargo.toml", "Cargo.lock"] {
        if fs::symlink_metadata(root.join(name)).is_ok_and(|m| m.is_file()) {
            files.push(name.to_owned());
        } else {
            unbound.push(name.to_owned());
        }
        println!("cargo:rerun-if-changed={}", root.join(name).display());
    }
    let crates = root.join("crates");
    println!("cargo:rerun-if-changed={}", crates.display());
    let mut members: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(&crates).expect("crates directory").flatten() {
        match entry.file_type() {
            Ok(kind) if kind.is_dir() => members.push(entry.path()),
            Ok(kind) if kind.is_file() => {}
            _ => unbound.push(relative(&root, &entry.path())),
        }
    }
    members.sort();
    for member in members {
        for file in ["Cargo.toml", "build.rs"] {
            let path = member.join(file);
            match fs::symlink_metadata(&path) {
                Ok(meta) if meta.is_file() => files.push(relative(&root, &path)),
                Ok(_) => unbound.push(relative(&root, &path)),
                Err(_) => {}
            }
            println!("cargo:rerun-if-changed={}", path.display());
        }
        for dir in ["src", "assets"] {
            let path = member.join(dir);
            collect(&root, &path, &mut files, &mut unbound);
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
    if unbound.is_empty() {
        println!("cargo:rustc-env=LUUNA_BUILD_IDENTITY=sha256:{identity}");
    } else {
        // A symlinked or special build input cannot be bound by content, so
        // the identity never matches a digest (the harness fails the same way).
        unbound.sort();
        println!(
            "cargo:rustc-env=LUUNA_BUILD_IDENTITY=unbound: symlinked or special build inputs {}",
            unbound.join(",")
        );
    }
    // The compiler Cargo actually invokes for this build, not whatever is on PATH.
    let rustc = std::env::var("RUSTC").unwrap_or_else(|_| "rustc".to_owned());
    let version = std::process::Command::new(&rustc)
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
    // The compiler's self-reported version cannot identify it: a shim selected
    // through `build.rustc` or `CARGO_BUILD_RUSTC` can print the pinned release.
    // The bytes of the executable Cargo invoked are hashed so they can be
    // compared with the pinned toolchain's own `rustc`.
    let rustc_sha256 = fs::read(&rustc)
        .map(|bytes| {
            Sha256::digest(&bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        })
        .unwrap_or_else(|_| "unknown".to_owned());
    println!("cargo:rustc-env=LUUNA_BUILD_RUSTC_SHA256={rustc_sha256}");
    // Cargo runs any configured wrapper around RUSTC (environment or config);
    // it can change how the binary is compiled, so it is reported, not hidden.
    let wrappers: Vec<String> = ["RUSTC_WRAPPER", "RUSTC_WORKSPACE_WRAPPER"]
        .iter()
        .filter_map(|name| {
            println!("cargo:rerun-if-env-changed={name}");
            std::env::var(name)
                .ok()
                .filter(|value| !value.is_empty())
                .map(|_| (*name).to_owned())
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
    // `vars_os`: an unrelated non-UTF-8 entry must not fail the build; the
    // names that matter here are ASCII. Cargo sets `RUSTC_LINKER` for build
    // scripts whenever a linker is configured (`target.<triple>.linker` or
    // `CARGO_TARGET_<TRIPLE>_LINKER`); a substituted linker can change the
    // binary, so it is reported as an override. So is any C toolchain setting
    // the `cc` crate honours (`luuna-storage` compiles the bundled SQLite with
    // it): the compiler, archiver and flags, plain or per target.
    const C_TOOLCHAIN: [&str; 9] = [
        "CC", "CXX", "AR", "RANLIB", "CFLAGS", "CXXFLAGS", "CPPFLAGS", "ARFLAGS", "LDFLAGS",
    ];
    let mut overrides: Vec<String> = std::env::vars_os()
        .map(|(name, _)| name.to_string_lossy().into_owned())
        .filter(|name| {
            name.starts_with("CARGO_PROFILE_")
                || (name.starts_with("CARGO_TARGET_")
                    && (name.ends_with("_RUSTFLAGS") || name.ends_with("_LINKER")))
                || name == "CARGO_BUILD_RUSTFLAGS"
                || name == "RUSTC_LINKER"
                || name.starts_with("CRATE_CC_")
                // Build-time settings the bundled SQLite (`libsqlite3-sys`) honours.
                || name.starts_with("SQLITE_")
                || name.starts_with("SQLITE3_")
                || name.starts_with("LIBSQLITE3_")
                || C_TOOLCHAIN.iter().any(|tool| {
                    name == tool
                        || ["TARGET_", "HOST_"]
                            .iter()
                            .any(|scope| name.strip_prefix(scope) == Some(tool))
                        || name
                            .strip_prefix(tool)
                            .is_some_and(|rest| rest.starts_with('_') || rest.starts_with('-'))
                })
        })
        .collect();
    overrides.sort();
    // Cargo reruns this script only for names it was told to watch, so every
    // supported spelling is registered whether or not it is set now: an
    // override that first appears on a later build (which would rebuild the
    // bundled SQLite) must also refresh the reported `overrides=`. Prefix
    // families with no fixed set of names (`CARGO_PROFILE_*`, the SQLite
    // compile options) are registered as found.
    let mut watched: Vec<String> = [
        "CARGO_BUILD_RUSTFLAGS",
        "RUSTC_LINKER",
        "CRATE_CC_NO_DEFAULTS",
        "LIBSQLITE3_FLAGS",
        "LIBSQLITE3_SYS_BUNDLING",
        "LIBSQLITE3_SYS_USE_PKG_CONFIG",
        "SQLITE_MAX_COLUMN",
        "SQLITE_MAX_EXPR_DEPTH",
        "SQLITE_MAX_VARIABLE_NUMBER",
        "SQLITE3_INCLUDE_DIR",
        "SQLITE3_LIB_DIR",
        "SQLITE3_STATIC",
    ]
    .iter()
    .map(|name| (*name).to_owned())
    .collect();
    let triples: Vec<String> = ["TARGET", "HOST"]
        .iter()
        .filter_map(|name| std::env::var(name).ok())
        .collect();
    for triple in &triples {
        let upper = triple.to_uppercase().replace(['-', '.'], "_");
        watched.push(format!("CARGO_TARGET_{upper}_LINKER"));
        watched.push(format!("CARGO_TARGET_{upper}_RUSTFLAGS"));
    }
    for tool in C_TOOLCHAIN {
        watched.extend([
            tool.to_owned(),
            format!("TARGET_{tool}"),
            format!("HOST_{tool}"),
        ]);
        for triple in &triples {
            watched.push(format!("{tool}_{triple}"));
            watched.push(format!("{tool}_{}", triple.replace('-', "_")));
            watched.push(format!("{tool}-{triple}"));
        }
    }
    watched.extend(overrides.iter().cloned());
    watched.sort();
    watched.dedup();
    for name in &watched {
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
    // These values are served by the unauthenticated `/health` route, so only
    // variable names and none/set status are embedded, never flag values,
    // wrapper paths or config file paths.
    println!(
        "cargo:rustc-env=LUUNA_BUILD_FLAGS=profile={} opt-level={} debug={} rustflags={} overrides={} config-overrides={}",
        value("PROFILE"),
        value("OPT_LEVEL"),
        value("DEBUG"),
        if rustflags.is_empty() { "none" } else { "set" },
        if overrides.is_empty() { "none".to_owned() } else { overrides.join(",") },
        if dependency_overrides.is_empty() { "none".to_owned() } else { format!("{}-files", dependency_overrides.len()) },
    );
}
