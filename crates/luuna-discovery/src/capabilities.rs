//! Host capability probing for stack profiles (M5).
//!
//! Discovery proposes recipes; whether this host can run them is a separate,
//! observed fact. The probe resolves each tool a profile's checks may need on
//! `PATH` (with `PATHEXT` on Windows, the way the executor does) and runs only
//! that tool's own version command (`node --version`, `go version`, …) with a
//! bounded timeout and bounded output. Nothing read from a repository is ever
//! executed here, and every probe receives an environment with Luuna
//! configuration, `GIT_*` and credential-shaped variables removed.
//!
//! The result annotates each proposed check `available` or `missing` and asks
//! the developer about every missing tool. A required check whose tool is
//! missing stays proposed: the executor records it `blocked` if it runs.
use luuna_domain::{
    CapabilityStatus, DiscoveryQuestion, HostCapabilities, ProposedCheck, ToolProbe,
};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

/// A version probe that has not answered by then is killed and the tool is
/// recorded without a version.
pub const PROBE_TIMEOUT: Duration = Duration::from_secs(15);
/// Version output beyond this is discarded and recorded as a probe failure.
pub const PROBE_OUTPUT_LIMIT: usize = 64 * 1024;
/// How long a cached host probe stays valid for repeated discoveries.
pub const PROBE_CACHE_TTL: Duration = Duration::from_secs(120);

/// Pseudo-tool recorded from `ANDROID_HOME` / `ANDROID_SDK_ROOT`, the way the
/// executor checks the `android-sdk` capability.
pub const ANDROID_SDK_TOOL: &str = "android-sdk";

/// Tools a profile's checks may need and the arguments that print their
/// version. `go`, `adb` and `java` have no `--version`.
const PROBED_TOOLS: [(&str, &[&str]); 20] = [
    ("git", &["--version"]),
    ("node", &["--version"]),
    ("npm", &["--version"]),
    ("pnpm", &["--version"]),
    ("yarn", &["--version"]),
    ("bun", &["--version"]),
    ("cargo", &["--version"]),
    ("rustc", &["--version"]),
    ("cargo-clippy", &["--version"]),
    ("go", &["version"]),
    ("python3", &["--version"]),
    ("python", &["--version"]),
    ("pytest", &["--version"]),
    ("ruff", &["--version"]),
    ("mypy", &["--version"]),
    ("flutter", &["--version"]),
    ("dart", &["--version"]),
    ("java", &["-version"]),
    ("gradle", &["--version"]),
    ("adb", &["version"]),
];

/// Tools that exist only with Xcode. On other hosts they are recorded missing
/// without a probe, so an iOS check is explicitly blocked (A31).
const MACOS_TOOLS: [(&str, &[&str]); 2] =
    [("xcodebuild", &["-version"]), ("swift", &["--version"])];

/// Which probed tools satisfy a declared capability; mirrors the executor's
/// table so the annotation predicts what execution will find. Unknown
/// capability names are descriptive tags (`test`, `lint`) and need no tool.
const CAPABILITY_TOOLS: [(&str, &[&str]); 21] = [
    ("cargo", &["cargo"]),
    ("rust", &["rustc"]),
    ("clippy", &["cargo-clippy"]),
    ("node", &["node"]),
    ("npm", &["npm"]),
    ("pnpm", &["pnpm"]),
    ("yarn", &["yarn"]),
    ("bun", &["bun"]),
    ("go", &["go"]),
    ("python", &["python3", "python"]),
    ("pytest", &["pytest"]),
    ("ruff", &["ruff"]),
    ("mypy", &["mypy"]),
    ("flutter", &["flutter"]),
    ("dart", &["dart"]),
    ("jdk", &["java"]),
    ("gradle", &["gradle"]),
    ("xcode", &["xcodebuild"]),
    ("git", &["git"]),
    ("android-sdk", &[ANDROID_SDK_TOOL]),
    ("android-device", &["adb"]),
];

/// Where a missing tool comes from; named in the developer's question.
pub fn install_hint(tool: &str) -> &'static str {
    match tool {
        "node" | "npm" => "install Node.js (nodejs.org, or a version manager such as volta/mise)",
        "pnpm" => "enable pnpm with `corepack enable` or install it from pnpm.io",
        "yarn" => "enable yarn with `corepack enable` or install it from yarnpkg.com",
        "bun" => "install Bun from bun.sh",
        "cargo" | "rustc" | "cargo-clippy" => "install Rust with rustup (rustup.rs); clippy is `rustup component add clippy`",
        "go" => "install Go from go.dev/dl",
        "python" | "python3" => "install Python 3 from python.org or the platform package manager",
        "pytest" => "install pytest into the interpreter the recipe uses (`python -m pip install pytest`)",
        "ruff" => "install ruff (`python -m pip install ruff`)",
        "mypy" => "install mypy (`python -m pip install mypy`)",
        "flutter" => "install the Flutter SDK (docs.flutter.dev/get-started/install) and put `flutter` on PATH",
        "dart" => "install the Dart SDK (dart.dev/get-dart) or the Flutter SDK",
        "java" => "install a JDK (for example Eclipse Temurin) and put `java` on PATH",
        "gradle" => "use the repository's Gradle wrapper, or install Gradle from gradle.org",
        "adb" => "install Android SDK platform-tools (Android Studio > SDK Manager) and put `adb` on PATH; a device or emulator must be connected",
        ANDROID_SDK_TOOL => "install the Android SDK with Android Studio and set ANDROID_HOME (or ANDROID_SDK_ROOT)",
        "xcodebuild" | "swift" => "requires macOS with Xcode installed (`xcode-select --install` provides the command line tools only)",
        "git" => "install Git (git-scm.com)",
        _ => "install the tool and put it on PATH",
    }
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

/// Probe every tool once, in parallel, and record the result.
pub fn probe_host() -> HostCapabilities {
    probe_host_on(std::env::var_os("PATH").as_deref())
}

/// The same probe against an explicit search path (tests, profiles).
pub fn probe_host_on(search_path: Option<&std::ffi::OsStr>) -> HostCapabilities {
    let pathext = std::env::var("PATHEXT").ok();
    let dirs: Vec<PathBuf> = search_path
        .map(std::env::split_paths)
        .map(|paths| paths.collect())
        .unwrap_or_default();
    let handles: Vec<_> = PROBED_TOOLS
        .iter()
        .map(|(tool, args)| {
            let dirs = dirs.clone();
            let pathext = pathext.clone();
            std::thread::spawn(move || probe_tool(tool, args, &dirs, pathext.as_deref()))
        })
        .collect();
    let mut tools: Vec<ToolProbe> = handles
        .into_iter()
        .zip(PROBED_TOOLS.iter())
        .map(|(handle, (tool, _))| {
            handle.join().unwrap_or_else(|_| ToolProbe {
                tool: (*tool).to_owned(),
                status: CapabilityStatus::Missing,
                version: None,
                detail: Some("probe thread panicked".into()),
            })
        })
        .collect();
    for (tool, args) in MACOS_TOOLS {
        tools.push(if cfg!(target_os = "macos") {
            probe_tool(tool, args, &dirs, pathext.as_deref())
        } else {
            ToolProbe {
                tool: tool.to_owned(),
                status: CapabilityStatus::Missing,
                version: None,
                detail: Some(format!(
                    "{tool} exists only on macOS with Xcode; this host is {}",
                    std::env::consts::OS
                )),
            }
        });
    }
    let sdk = std::env::var_os("ANDROID_HOME")
        .or_else(|| std::env::var_os("ANDROID_SDK_ROOT"))
        .map(PathBuf::from);
    tools.push(match sdk {
        Some(path) if path.is_dir() => ToolProbe {
            tool: ANDROID_SDK_TOOL.into(),
            status: CapabilityStatus::Available,
            version: None,
            detail: Some("ANDROID_HOME or ANDROID_SDK_ROOT names an existing directory".into()),
        },
        Some(path) => ToolProbe {
            tool: ANDROID_SDK_TOOL.into(),
            status: CapabilityStatus::Missing,
            version: None,
            detail: Some(format!(
                "ANDROID_HOME/ANDROID_SDK_ROOT is set but {} is not a directory",
                path.display()
            )),
        },
        None => ToolProbe {
            tool: ANDROID_SDK_TOOL.into(),
            status: CapabilityStatus::Missing,
            version: None,
            detail: Some("neither ANDROID_HOME nor ANDROID_SDK_ROOT is set".into()),
        },
    });
    HostCapabilities {
        probed_at: now(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        tools,
    }
}

/// [`probe_host`] with a process-wide cache, so repeated discoveries do not
/// start twenty version probes each. The cache expires after
/// [`PROBE_CACHE_TTL`]; a tool installed meanwhile is seen by the next probe.
pub fn probe_host_cached() -> HostCapabilities {
    static CACHE: OnceLock<Mutex<Option<(Instant, HostCapabilities)>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(guard) = cache.lock() {
        if let Some((at, probed)) = guard.as_ref() {
            if at.elapsed() < PROBE_CACHE_TTL {
                return probed.clone();
            }
        }
    }
    let probed = probe_host();
    if let Ok(mut guard) = cache.lock() {
        *guard = Some((Instant::now(), probed.clone()));
    }
    probed
}

fn probe_tool(tool: &str, args: &[&str], dirs: &[PathBuf], pathext: Option<&str>) -> ToolProbe {
    let Some(resolved) = find_on_path(tool, dirs, pathext) else {
        return ToolProbe {
            tool: tool.to_owned(),
            status: CapabilityStatus::Missing,
            version: None,
            detail: Some("not found on PATH".into()),
        };
    };
    match run_version_probe(&resolved, args) {
        Ok(version) => ToolProbe {
            tool: tool.to_owned(),
            status: CapabilityStatus::Available,
            version,
            detail: None,
        },
        Err(failure) => {
            // Windows installs app-execution aliases (`python3.exe`) that only
            // open the Microsoft Store; such a stub is not an available tool.
            let store_alias = cfg!(windows)
                && resolved
                    .components()
                    .any(|c| c.as_os_str().eq_ignore_ascii_case("WindowsApps"));
            if store_alias {
                ToolProbe {
                    tool: tool.to_owned(),
                    status: CapabilityStatus::Missing,
                    version: None,
                    detail: Some(format!(
                        "{} is a Microsoft Store app-execution alias whose version probe {failure}",
                        resolved.display()
                    )),
                }
            } else {
                ToolProbe {
                    tool: tool.to_owned(),
                    status: CapabilityStatus::Available,
                    version: None,
                    detail: Some(format!(
                        "found at {} but its version probe {failure}",
                        resolved.display()
                    )),
                }
            }
        }
    }
}

/// Run `<resolved> <args>` with a sanitised environment, a hard deadline and
/// bounded output. Returns the first line it printed when it exited 0.
fn run_version_probe(resolved: &Path, args: &[&str]) -> Result<Option<String>, String> {
    let mut command = Command::new(resolved);
    command
        .args(args)
        .env_clear()
        .envs(
            std::env::vars_os().filter(|(name, _)| !is_secret_or_reserved(&name.to_string_lossy())),
        )
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|e| format!("could not start: {}", e.kind()))?;
    let (Some(stdout), Some(stderr)) = (child.stdout.take(), child.stderr.take()) else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("had no output pipes".into());
    };
    let out = std::thread::spawn(move || read_bounded(stdout));
    let err = std::thread::spawn(move || read_bounded(stderr));
    let deadline = Instant::now() + PROBE_TIMEOUT;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if Instant::now() >= deadline => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(format!("timed out after {}s", PROBE_TIMEOUT.as_secs()));
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(20)),
            Err(error) => {
                let _ = child.kill();
                return Err(format!("failed: {}", error.kind()));
            }
        }
    };
    let out = out.join().map_err(|_| "reader panicked".to_owned())?;
    let err = err.join().map_err(|_| "reader panicked".to_owned())?;
    if out.len() > PROBE_OUTPUT_LIMIT || err.len() > PROBE_OUTPUT_LIMIT {
        return Err(format!("printed more than {PROBE_OUTPUT_LIMIT} bytes"));
    }
    if !status.success() {
        return Err(match status.code() {
            Some(code) => format!("exited with status {code}"),
            None => "was terminated by a signal".into(),
        });
    }
    let text = if out.is_empty() { err } else { out };
    Ok(String::from_utf8_lossy(&text)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.chars().take(200).collect()))
}

fn read_bounded(mut reader: impl Read) -> Vec<u8> {
    let mut buffer = Vec::new();
    let _ = reader
        .by_ref()
        .take(PROBE_OUTPUT_LIMIT as u64 + 1)
        .read_to_end(&mut buffer);
    buffer
}

/// Variables that never reach a probe: Luuna's own configuration,
/// repository-redirecting Git variables and anything credential-shaped
/// (the executor applies the same rule to checks).
fn is_secret_or_reserved(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.starts_with("LUUNA_")
        || upper.starts_with("GIT_")
        || [
            "API_KEY",
            "APIKEY",
            "TOKEN",
            "SECRET",
            "PASSWORD",
            "PASSWD",
            "CREDENTIAL",
            "PRIVATE_KEY",
            "AUTH",
            "JWT",
            "PASSPHRASE",
            "BEARER",
            "COOKIE",
            "SESSION_KEY",
            "ACCESS_KEY",
            "WEBHOOK",
            "CONNECTION_STRING",
            "CONNSTR",
            "DATABASE_URL",
        ]
        .iter()
        .any(|marker| upper.contains(marker))
        || upper == "BW_SESSION"
        || upper.starts_with("OP_SESSION_")
        || ["_PASS", "_PWD", "_PAT", "_DSN", "_KEY", "_KEYS"]
            .iter()
            .any(|suffix| upper.ends_with(suffix))
        || upper.contains("_KEY_")
}

/// Executable file names tried for `name` in each search directory. On
/// Windows only the startable `PATHEXT` extensions are tried, in `PATHEXT`
/// order, so the extensionless POSIX shims beside `npm.cmd` are never chosen.
fn path_candidates(name: &str, pathext: Option<&str>) -> Vec<String> {
    if !cfg!(windows) {
        return vec![name.to_owned()];
    }
    const SPAWNABLE: [&str; 4] = [".com", ".exe", ".bat", ".cmd"];
    let parse = |list: &str| {
        let mut extensions: Vec<String> = Vec::new();
        for extension in list.split(';').map(|e| e.trim().to_ascii_lowercase()) {
            if SPAWNABLE.contains(&extension.as_str()) && !extensions.contains(&extension) {
                extensions.push(extension);
            }
        }
        extensions
    };
    let mut extensions = parse(pathext.unwrap_or_default());
    if extensions.is_empty() {
        extensions = parse(".COM;.EXE;.BAT;.CMD");
    }
    let lower = name.to_ascii_lowercase();
    if extensions.iter().any(|e| lower.ends_with(e.as_str())) {
        return vec![name.to_owned()];
    }
    extensions.iter().map(|e| format!("{name}{e}")).collect()
}

fn is_executable_file(path: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).is_ok_and(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
    }
    #[cfg(not(unix))]
    {
        path.is_file()
    }
}

/// The first executable named `name` on the search path; relative entries are
/// ignored because they would resolve against the runtime's own directory.
pub fn find_on_path(name: &str, dirs: &[PathBuf], pathext: Option<&str>) -> Option<PathBuf> {
    let candidates = path_candidates(name, pathext);
    dirs.iter().filter(|dir| dir.is_absolute()).find_map(|dir| {
        candidates
            .iter()
            .map(|candidate| dir.join(candidate))
            .find(|path| is_executable_file(path))
    })
}

/// The interpreter a Python recipe should name on this host. The executor
/// resolves the capability with either name, but the recipe must name one
/// that exists: Windows installs `python`, most Unix hosts only `python3`.
pub fn python_executable(host: Option<&HostCapabilities>) -> &'static str {
    match host {
        Some(host) if cfg!(windows) && host.available("python") => "python",
        Some(host) if host.available("python3") => "python3",
        Some(host) if host.available("python") => "python",
        _ if cfg!(windows) => "python",
        _ => "python3",
    }
}

/// Tools a check needs on this host that the probe did not find: one per
/// declared capability the table knows (the first available tool satisfies
/// it), plus the bare executable itself when it is a probed tool. A
/// repository-relative executable (`./gradlew`) must exist under `root`.
pub fn missing_tools(check: &ProposedCheck, host: &HostCapabilities, root: &Path) -> Vec<String> {
    let mut missing = BTreeSet::new();
    for capability in &check.check.capabilities {
        if let Some((_, tools)) = CAPABILITY_TOOLS.iter().find(|(name, _)| name == capability) {
            if !tools.iter().any(|tool| host.available(tool)) {
                // Name the conventional tool (python3 on Unix, python on Windows).
                let named = if *capability == "python" {
                    python_executable(Some(host))
                } else {
                    tools[0]
                };
                missing.insert(named.to_owned());
            }
        }
    }
    let executable = &check.check.executable;
    if executable.contains('/') || executable.contains('\\') {
        let relative = executable.trim_start_matches("./");
        if !root.join(relative).is_file() {
            missing.insert(executable.clone());
        }
    } else if host.tool(executable).is_some() && !host.available(executable) {
        // A capability already named its conventional tool (`python3` for
        // the `python` capability on Unix); the interpreter spelled in the
        // recipe is the same missing tool, not a second one.
        let covered = check.check.capabilities.iter().any(|capability| {
            CAPABILITY_TOOLS
                .iter()
                .any(|(name, tools)| name == capability && tools.contains(&executable.as_str()))
        });
        if !covered {
            missing.insert(executable.clone());
        }
    }
    missing.into_iter().collect()
}

/// Annotate every proposed check with the host's capability and ask about
/// each missing tool, naming the profiles and checks that need it and how to
/// install it. Checks are never dropped here.
pub fn annotate(
    repository_id: &str,
    root: &Path,
    profiles: &[String],
    checks: &mut [ProposedCheck],
    host: &HostCapabilities,
) -> Vec<DiscoveryQuestion> {
    let mut by_tool: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for proposed in checks.iter_mut() {
        let missing = missing_tools(proposed, host, root);
        proposed.capability = Some(if missing.is_empty() {
            CapabilityStatus::Available
        } else {
            CapabilityStatus::Missing
        });
        for tool in &missing {
            by_tool
                .entry(tool.clone())
                .or_default()
                .push(proposed.check.id.clone());
        }
        proposed.missing_tools = missing;
    }
    by_tool
        .into_iter()
        .map(|(tool, check_ids)| {
            let detail = host
                .tool(&tool)
                .and_then(|probe| probe.detail.clone())
                .unwrap_or_else(|| "not found on PATH".into());
            DiscoveryQuestion {
                repository_id: Some(repository_id.into()),
                topic: "missing-tool".into(),
                detail: format!(
                    "profile {} check(s) {} need `{tool}`, which this host lacks ({detail}); {}; then run discovery again, or drop the recipe before confirming. The recipe stays proposed: if it is confirmed and run here, the executor records it blocked (incapable host), never passed",
                    profiles.join("+"),
                    check_ids.join(", "),
                    install_hint(&tool)
                ),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use luuna_domain::{Confidence, ManifestCheck};

    fn host(available: &[&str]) -> HostCapabilities {
        let names: Vec<&str> = PROBED_TOOLS
            .iter()
            .map(|(t, _)| *t)
            .chain(MACOS_TOOLS.iter().map(|(t, _)| *t))
            .chain([ANDROID_SDK_TOOL])
            .collect();
        HostCapabilities {
            probed_at: "2026-10-21T00:00:00.000Z".into(),
            os: "test".into(),
            arch: "test".into(),
            tools: names
                .into_iter()
                .map(|tool| ToolProbe {
                    tool: tool.into(),
                    status: if available.contains(&tool) {
                        CapabilityStatus::Available
                    } else {
                        CapabilityStatus::Missing
                    },
                    version: available.contains(&tool).then(|| format!("{tool} 1.0")),
                    detail: None,
                })
                .collect(),
        }
    }

    fn proposed(executable: &str, capabilities: &[&str]) -> ProposedCheck {
        ProposedCheck {
            check: ManifestCheck {
                id: format!("{}-test", executable.trim_start_matches("./")),
                executable: executable.into(),
                args: vec!["test".into()],
                required: true,
                timeout_seconds: 60,
                capabilities: capabilities.iter().map(|c| (*c).to_owned()).collect(),
                cwd: ".".into(),
            },
            evidence: vec![],
            confidence: Confidence::Inferred,
            capability: None,
            missing_tools: vec![],
        }
    }

    #[test]
    fn annotation_follows_the_probe_and_asks_about_each_missing_tool() {
        let dir = tempfile::tempdir().unwrap();
        let some = host(&["node", "npm", "cargo", "rustc", "python"]);
        let mut checks = vec![
            proposed("npm", &["node", "npm", "test"]),
            proposed("cargo", &["rust", "cargo"]),
            proposed("flutter", &["flutter"]),
            proposed("xcodebuild", &["xcode"]),
            proposed("./gradlew", &["jdk", "android-sdk"]),
        ];
        let questions = annotate("app", dir.path(), &["x".into()], &mut checks, &some);
        assert_eq!(checks[0].capability, Some(CapabilityStatus::Available));
        assert!(checks[0].missing_tools.is_empty());
        assert_eq!(checks[1].capability, Some(CapabilityStatus::Available));
        assert_eq!(checks[2].capability, Some(CapabilityStatus::Missing));
        assert_eq!(checks[2].missing_tools, vec!["flutter"]);
        assert_eq!(checks[3].missing_tools, vec!["xcodebuild"]);
        assert_eq!(
            checks[4].missing_tools,
            vec!["./gradlew", "android-sdk", "java"]
        );
        let tools: Vec<&str> = questions
            .iter()
            .map(|q| {
                assert_eq!(q.topic, "missing-tool");
                assert!(q.detail.contains("blocked"), "{}", q.detail);
                q.detail.split('`').nth(1).unwrap()
            })
            .collect();
        assert_eq!(
            tools,
            vec!["./gradlew", "android-sdk", "flutter", "java", "xcodebuild"]
        );
        assert_eq!(checks.len(), 5, "missing tools never drop a check");
        // A `python` capability names the interpreter the host has.
        let mut python = vec![proposed("python", &["python"])];
        let none = host(&[]);
        annotate("app", dir.path(), &[], &mut python, &none);
        assert_eq!(
            python[0].missing_tools,
            vec![python_executable(Some(&none))]
        );
    }

    #[test]
    fn probing_runs_only_version_commands_and_bounds_them() {
        // An empty search path finds nothing and starts nothing.
        let nothing = probe_host_on(Some(std::ffi::OsStr::new("")));
        assert!(nothing
            .tools
            .iter()
            .filter(|t| t.tool != ANDROID_SDK_TOOL)
            .all(|t| t.status == CapabilityStatus::Missing));
        assert!(nothing.tool("xcodebuild").is_some());
        // The real host: every available tool resolved on PATH with PATHEXT rules.
        let real = probe_host_cached();
        let again = probe_host_cached();
        assert_eq!(real.probed_at, again.probed_at, "cached within the TTL");
        for tool in &real.tools {
            if tool.status == CapabilityStatus::Available && tool.tool != ANDROID_SDK_TOOL {
                let dirs: Vec<PathBuf> = std::env::var_os("PATH")
                    .map(|p| std::env::split_paths(&p).collect())
                    .unwrap_or_default();
                let resolved =
                    find_on_path(&tool.tool, &dirs, std::env::var("PATHEXT").ok().as_deref())
                        .unwrap_or_else(|| panic!("{} available but unresolved", tool.tool));
                if cfg!(windows) {
                    let ext = resolved
                        .extension()
                        .map(|e| e.to_string_lossy().to_ascii_lowercase())
                        .unwrap_or_default();
                    assert!(
                        ["com", "exe", "bat", "cmd"].contains(&ext.as_str()),
                        "{}",
                        resolved.display()
                    );
                }
            }
        }
        assert!(is_secret_or_reserved("GITHUB_TOKEN"));
        assert!(is_secret_or_reserved("GIT_DIR"));
        assert!(is_secret_or_reserved("LUUNA_TOKEN"));
        assert!(!is_secret_or_reserved("PATHEXT"));
        assert!(!is_secret_or_reserved("PWD"));
    }
}
