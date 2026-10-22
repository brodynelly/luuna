//! Offline maintenance commands for the runtime's data directory (ADR 0016):
//!
//! - `luuna-runtime backup --output <file>` writes a consistent snapshot of the
//!   database while the runtime may be running;
//! - `luuna-runtime restore --input <file>` installs a verified snapshot and
//!   requires the runtime to be stopped;
//! - `luuna-runtime check` reports the database's integrity and schema version;
//! - `luuna-runtime doctor [--json]` diagnoses the host: Git, Python, Node, the
//!   Pi launcher, the data directory and database, token and credential
//!   presence (names only, never values), the service port and the pinned
//!   component toolchain (ADR 0018). It exits 1 when a required item (Git,
//!   Pi, a writable data directory) is missing.
//!
//! Each accepts `--data-dir <dir>`; the default is the runtime's own
//! (`LUUNA_DATA_DIR`, else `.luuna` in the current directory). The snapshot
//! covers the database (projects, plans, approvals, runs, events and evidence
//! records); check artifacts and worktrees are files in the data directory,
//! so a complete backup is a copy of the whole directory while it is stopped.
use fs2::FileExt;
use sha2::{Digest, Sha256};
use std::{
    ffi::OsString,
    io::Read,
    path::{Path, PathBuf},
};

type Outcome = Result<(), Box<dyn std::error::Error>>;

const USAGE: &str = "usage: luuna-runtime backup --output <file> [--data-dir <dir>]
       luuna-runtime restore --input <file> [--data-dir <dir>]
       luuna-runtime check [--data-dir <dir>]
       luuna-runtime doctor [--data-dir <dir>] [--json]";

/// Run a maintenance command named by the first argument. `None` means the
/// arguments name no such command and the service should start as usual.
pub fn dispatch(arguments: impl IntoIterator<Item = OsString>) -> Option<Outcome> {
    let mut arguments = arguments.into_iter();
    let command = arguments.next()?;
    let command = match command.to_str() {
        Some(name @ ("backup" | "restore" | "check" | "doctor")) => name.to_owned(),
        _ => return None,
    };
    let outcome = parse(arguments.collect()).and_then(|options| match command.as_str() {
        "backup" => backup(&options),
        "restore" => restore(&options),
        "doctor" => doctor(&options),
        _ => check(&options),
    });
    Some(outcome.map_err(|error| Box::new(Failure(error.to_string())) as _))
}

/// `main` prints a returned error with `Debug`; show the readable message.
struct Failure(String);

impl std::fmt::Debug for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::fmt::Display for Failure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for Failure {}

struct Options {
    data_dir: PathBuf,
    output: Option<PathBuf>,
    input: Option<PathBuf>,
    json: bool,
}

fn parse(arguments: Vec<OsString>) -> Result<Options, Box<dyn std::error::Error>> {
    let mut options = Options {
        data_dir: default_data_dir()?,
        output: None,
        input: None,
        json: false,
    };
    let mut arguments = arguments.into_iter();
    while let Some(flag) = arguments.next() {
        if flag.to_str() == Some("--json") {
            options.json = true;
            continue;
        }
        let mut value = || {
            arguments
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| format!("{} needs a value\n{USAGE}", flag.to_string_lossy()))
        };
        match flag.to_str() {
            Some("--data-dir") => options.data_dir = absolute(value()?)?,
            Some("--output") => options.output = Some(absolute(value()?)?),
            Some("--input") => options.input = Some(absolute(value()?)?),
            _ => {
                return Err(format!("unknown argument {}\n{USAGE}", flag.to_string_lossy()).into())
            }
        }
    }
    Ok(options)
}

/// The same data directory the service uses.
fn default_data_dir() -> Result<PathBuf, Box<dyn std::error::Error>> {
    absolute(PathBuf::from(
        std::env::var("LUUNA_DATA_DIR").unwrap_or_else(|_| ".luuna".into()),
    ))
}

fn absolute(path: PathBuf) -> Result<PathBuf, Box<dyn std::error::Error>> {
    Ok(if path.is_absolute() {
        path
    } else {
        std::env::current_dir()?.join(path)
    })
}

fn database(options: &Options) -> PathBuf {
    options.data_dir.join("luuna.sqlite3")
}

/// Online: SQLite readers do not block the running service's writers.
fn backup(options: &Options) -> Outcome {
    let output = options
        .output
        .as_ref()
        .ok_or_else(|| format!("backup needs --output <file>\n{USAGE}"))?;
    let report = luuna_storage::backup_database(&database(options), output)?;
    println!("backup: {}", report.path.display());
    println!("schema_version: {}", report.schema_version);
    println!("size_bytes: {}", report.size_bytes);
    println!("sha256: {}", sha256_file(&report.path)?);
    println!(
        "note: check artifacts and worktrees are files under {}; a complete backup is a copy of that directory while the runtime is stopped",
        options.data_dir.display()
    );
    Ok(())
}

/// Offline: the data directory's owner lock proves no runtime is using it.
fn restore(options: &Options) -> Outcome {
    let input = options
        .input
        .as_ref()
        .ok_or_else(|| format!("restore needs --input <file>\n{USAGE}"))?;
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder.create(&options.data_dir)?;
    let mut lock = std::fs::OpenOptions::new();
    lock.read(true).write(true).create(true).truncate(false);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        lock.mode(0o600);
    }
    let lock = lock.open(options.data_dir.join("runtime.lock"))?;
    lock.try_lock_exclusive().map_err(|_| {
        format!(
            "a Luuna runtime owns {}; stop it (POST /api/v1/shutdown, Ctrl+C or the stop script) before restoring",
            options.data_dir.display()
        )
    })?;
    let digest = sha256_file(input)?;
    let result = luuna_storage::restore_database(input, &database(options));
    let _ = FileExt::unlock(&lock);
    let report = result?;
    println!("restored: {}", report.database.display());
    println!("from: {} (sha256 {digest})", input.display());
    println!("schema_version: {}", report.schema_version);
    match &report.replaced {
        Some(directory) => println!("previous database moved to: {}", directory.display()),
        None => println!("previous database: none"),
    }
    Ok(())
}

fn check(options: &Options) -> Outcome {
    let status = luuna_storage::inspect_database(&database(options))?;
    println!("database: {}", status.path.display());
    println!(
        "schema_version: {} (this build supports up to {})",
        status.schema_version, status.supported_version
    );
    match &status.integrity_problem {
        None => println!("integrity: ok"),
        Some(problem) => println!("integrity: FAILED ({problem})"),
    }
    status.require_usable()?;
    Ok(())
}

/// One diagnosed item. `status` is `ok`, `missing` or `warning`; a missing
/// required item fails the command.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DoctorItem {
    pub name: &'static str,
    pub required: bool,
    pub status: &'static str,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct DoctorReport {
    pub ok: bool,
    pub items: Vec<DoctorItem>,
}

/// The probes a report is assembled from; tests inject them, the command
/// runs them against the host. `Ok` carries a one-line detail.
pub struct DoctorProbes {
    pub git: Box<dyn Fn() -> Result<String, String>>,
    pub python: Box<dyn Fn() -> Result<String, String>>,
    pub node: Box<dyn Fn() -> Result<String, String>>,
    pub pi: Box<dyn Fn() -> Result<String, String>>,
    pub data_dir: Box<dyn Fn() -> Result<String, String>>,
    /// `Ok(None)` when no database exists yet (the runtime creates it).
    pub database: Box<dyn Fn() -> Result<Option<String>, String>>,
    pub api_token_configured: bool,
    pub github_token_configured: bool,
    /// Provider credential variable names that are set (never values).
    pub provider_keys: Vec<String>,
    pub port: Box<dyn Fn() -> PortStatus>,
    pub components: Box<dyn Fn() -> Result<String, String>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PortStatus {
    Free(u16),
    /// A Luuna runtime already answers `/health` there.
    LuunaRunning(u16),
    /// Something else holds the port, or it could not be probed.
    Busy(u16, String),
}

fn item(name: &'static str, required: bool, outcome: Result<String, String>) -> DoctorItem {
    match outcome {
        Ok(detail) => DoctorItem {
            name,
            required,
            status: "ok",
            detail,
        },
        Err(detail) => DoctorItem {
            name,
            required,
            status: if required { "missing" } else { "warning" },
            detail,
        },
    }
}

fn presence(name: &'static str, configured: bool, present: &str, absent: &str) -> DoctorItem {
    DoctorItem {
        name,
        required: false,
        status: if configured { "ok" } else { "warning" },
        detail: if configured { present } else { absent }.into(),
    }
}

/// Assemble the report from probe results. Git, Pi and a writable data
/// directory are required; an existing database that is damaged or too new
/// also fails the report, because the service would refuse to start on it.
/// Everything else is advisory.
pub fn doctor_report(probes: &DoctorProbes) -> DoctorReport {
    let database = match (probes.database)() {
        Ok(Some(detail)) => item("database", false, Ok(detail)),
        Ok(None) => item(
            "database",
            false,
            Ok("not created yet; the runtime creates it at first start".into()),
        ),
        Err(detail) => DoctorItem {
            name: "database",
            required: false,
            status: "missing",
            detail,
        },
    };
    let port = match (probes.port)() {
        PortStatus::Free(port) => item("port", false, Ok(format!("127.0.0.1:{port} is free"))),
        PortStatus::LuunaRunning(port) => item(
            "port",
            false,
            Ok(format!(
                "a Luuna runtime already answers http://127.0.0.1:{port}/health"
            )),
        ),
        PortStatus::Busy(port, detail) => item(
            "port",
            false,
            Err(format!(
                "127.0.0.1:{port} is in use and does not answer as Luuna ({detail}); set LUUNA_PORT"
            )),
        ),
    };
    let providers = if probes.provider_keys.is_empty() {
        Err("no provider credential variable is set (model runs fail until one is)".to_owned())
    } else {
        Ok(format!(
            "configured: {} (values not shown)",
            probes.provider_keys.join(", ")
        ))
    };
    let items = vec![
        item("git", true, (probes.git)()),
        item("python", false, (probes.python)()),
        item("node", false, (probes.node)()),
        item("pi", true, (probes.pi)()),
        item("data_dir", true, (probes.data_dir)()),
        database,
        presence(
            "api_token",
            probes.api_token_configured,
            "LUUNA_API_TOKEN is configured (value not shown)",
            "LUUNA_API_TOKEN is not set; the service refuses to start without it",
        ),
        presence(
            "github_token",
            probes.github_token_configured,
            "LUUNA_GITHUB_TOKEN is configured (value not shown)",
            "LUUNA_GITHUB_TOKEN is not set; publication to GitHub is unavailable",
        ),
        item("provider_credentials", false, providers),
        port,
        item("components", false, (probes.components)()),
    ];
    let ok = items.iter().all(|item| item.status != "missing");
    DoctorReport { ok, items }
}

fn version_of(program: &str, argument: &str) -> Result<String, String> {
    let output = std::process::Command::new(program)
        .arg(argument)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("{program} not found on PATH ({error})"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).into_owned();
    let line = stdout
        .lines()
        .chain(stderr.lines())
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .to_owned();
    if !output.status.success() {
        return Err(format!(
            "{program} {argument} exited with {}",
            output.status
        ));
    }
    Ok(line)
}

/// The Pi launcher the service would start, resolved and version-probed in a
/// private temporary directory (no model call, no user Pi configuration).
fn probe_pi() -> Result<String, String> {
    let program =
        PathBuf::from(std::env::var_os("LUUNA_PI_COMMAND").unwrap_or_else(|| "pi".into()));
    let launcher_args: Vec<String> = match std::env::var("LUUNA_PI_ARGS_JSON") {
        Ok(raw) => serde_json::from_str(&raw).map_err(|error| {
            format!("LUUNA_PI_ARGS_JSON is not a JSON array of strings: {error}")
        })?,
        Err(_) => Vec::new(),
    };
    let (resolved, args) = luuna_engine_pi::resolve_launcher(&program, &launcher_args)
        .map_err(|error| error.to_string())?;
    let scratch = std::env::temp_dir().join(format!("luuna-doctor-{}", uuid::Uuid::new_v4()));
    let config = luuna_engine_pi::PiConfig {
        program,
        launcher_args,
        cwd: scratch.join("cwd"),
        config_dir: scratch.join("config"),
        provider: None,
        model: None,
        profile: luuna_engine_pi::SessionProfile::ToolFree,
    };
    // `main` already runs inside a Tokio runtime; the probe gets its own on a
    // plain thread.
    let probe = std::thread::spawn(move || {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .map_err(|error| error.to_string())
            .and_then(|runtime| {
                runtime
                    .block_on(luuna_engine_pi::verify_version(&config))
                    .map_err(|error| error.to_string())
            })
    })
    .join()
    .map_err(|_| "the Pi probe panicked".to_owned());
    let _ = std::fs::remove_dir_all(&scratch);
    probe??;
    Ok(format!(
        "pi {} at {}{}",
        luuna_engine_pi::PI_VERSION,
        resolved.display(),
        if args.is_empty() {
            String::new()
        } else {
            format!(" {}", args.join(" "))
        }
    ))
}

fn probe_data_dir(data_dir: &Path) -> Result<String, String> {
    if !data_dir.is_dir() {
        return Err(format!(
            "{} does not exist; the runtime creates it at first start if its parent is writable",
            data_dir.display()
        ));
    }
    let probe = data_dir.join(format!(".doctor-{}", uuid::Uuid::new_v4()));
    std::fs::write(&probe, b"doctor")
        .map_err(|error| format!("{} is not writable: {error}", data_dir.display()))?;
    let _ = std::fs::remove_file(&probe);
    Ok(format!("{} exists and is writable", data_dir.display()))
}

fn probe_database(path: &Path) -> Result<Option<String>, String> {
    if !path.is_file() {
        return Ok(None);
    }
    let status = luuna_storage::inspect_database(path).map_err(|error| error.to_string())?;
    status.require_usable().map_err(|error| error.to_string())?;
    Ok(Some(format!(
        "{} schema version {} (this build supports up to {}), integrity ok",
        status.path.display(),
        status.schema_version,
        status.supported_version
    )))
}

/// Bind the port; when it is taken, ask whoever holds it for `/health` with a
/// plain HTTP/1.0 request under a short deadline.
fn probe_port(port: u16) -> PortStatus {
    use std::io::{Read, Write};
    let address = std::net::SocketAddrV4::new(std::net::Ipv4Addr::LOCALHOST, port);
    if std::net::TcpListener::bind(address).is_ok() {
        return PortStatus::Free(port);
    }
    let answer = (|| -> Result<String, String> {
        let deadline = std::time::Duration::from_secs(2);
        let mut stream = std::net::TcpStream::connect_timeout(&address.into(), deadline)
            .map_err(|error| error.to_string())?;
        let _ = stream.set_read_timeout(Some(deadline));
        let _ = stream.set_write_timeout(Some(deadline));
        stream
            .write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n")
            .map_err(|error| error.to_string())?;
        let mut buffer = Vec::new();
        let _ = stream.take(64 * 1024).read_to_end(&mut buffer);
        Ok(String::from_utf8_lossy(&buffer).into_owned())
    })();
    match answer {
        Ok(text) if text.starts_with("HTTP/1.") && text.contains("\"pi_version\"") => {
            PortStatus::LuunaRunning(port)
        }
        Ok(text) => PortStatus::Busy(
            port,
            text.lines()
                .next()
                .filter(|line| !line.is_empty())
                .unwrap_or("no HTTP answer")
                .chars()
                .take(80)
                .collect(),
        ),
        Err(detail) => PortStatus::Busy(port, detail),
    }
}

fn host_probes(options: &Options) -> DoctorProbes {
    let data_dir = options.data_dir.clone();
    let database_path = database(options);
    let port = std::env::var("LUUNA_PORT")
        .ok()
        .and_then(|raw| raw.parse::<u16>().ok())
        .unwrap_or(4242);
    let python = if cfg!(windows) { "python" } else { "python3" };
    DoctorProbes {
        git: Box::new(|| {
            let program = std::env::var("LUUNA_GIT_COMMAND").unwrap_or_else(|_| "git".into());
            version_of(&program, "--version")
        }),
        python: Box::new(move || version_of(python, "--version")),
        node: Box::new(|| version_of("node", "--version")),
        pi: Box::new(probe_pi),
        data_dir: Box::new(move || probe_data_dir(&data_dir)),
        database: Box::new(move || probe_database(&database_path)),
        api_token_configured: std::env::var_os("LUUNA_API_TOKEN").is_some_and(|v| !v.is_empty()),
        github_token_configured: std::env::var_os("LUUNA_GITHUB_TOKEN")
            .is_some_and(|v| !v.is_empty()),
        provider_keys: luuna_engine_pi::configured_provider_keys()
            .into_iter()
            .map(ToOwned::to_owned)
            .collect(),
        port: Box::new(move || probe_port(port)),
        components: Box::new(|| {
            luuna_components::Components::discover()
                .map(|_| "pinned Missions/Atlas/Beacon toolchain discovered".to_owned())
                .map_err(|error| format!("component toolchain unavailable: {error}"))
        }),
    }
}

fn doctor(options: &Options) -> Outcome {
    let report = doctor_report(&host_probes(options));
    if options.json {
        println!("{}", serde_json::to_string_pretty(&report)?);
    } else {
        for item in &report.items {
            println!(
                "{:<8} {:<20} {}{}",
                item.status,
                item.name,
                item.detail,
                if item.required { " (required)" } else { "" }
            );
        }
        println!("doctor: {}", if report.ok { "ok" } else { "FAILED" });
    }
    if report.ok {
        Ok(())
    } else {
        Err("doctor found a missing required item or an unusable database; see the report".into())
    }
}

fn sha256_file(path: &Path) -> Result<String, Box<dyn std::error::Error>> {
    let mut file = std::fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0; 64 * 1024];
    loop {
        let read = file.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(digest
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn arguments(values: &[&str]) -> Vec<OsString> {
        values.iter().map(OsString::from).collect()
    }

    #[test]
    fn only_maintenance_commands_are_dispatched() {
        // No arguments (every launcher today) and anything else start the service.
        assert!(dispatch(arguments(&[])).is_none());
        assert!(dispatch(arguments(&["--port", "4242"])).is_none());
        let refused = dispatch(arguments(&["backup"])).unwrap().unwrap_err();
        assert!(refused.to_string().contains("--output"), "{refused}");
        let refused = dispatch(arguments(&["check", "--force"]))
            .unwrap()
            .unwrap_err();
        assert!(refused.to_string().contains("unknown argument --force"));
        let refused = dispatch(arguments(&["restore", "--input"]))
            .unwrap()
            .unwrap_err();
        assert!(refused.to_string().contains("needs a value"));
        let refused = dispatch(arguments(&["doctor", "--bogus"]))
            .unwrap()
            .unwrap_err();
        assert!(refused.to_string().contains("unknown argument --bogus"));
    }

    fn probes(pi: Result<String, String>, data_dir: Result<String, String>) -> DoctorProbes {
        DoctorProbes {
            git: Box::new(|| Ok("git version 2.55.0".into())),
            python: Box::new(|| Err("python not found".into())),
            node: Box::new(|| Ok("v26.0.0".into())),
            pi: Box::new(move || pi.clone()),
            data_dir: Box::new(move || data_dir.clone()),
            database: Box::new(|| Ok(None)),
            api_token_configured: true,
            github_token_configured: false,
            provider_keys: vec!["OPENROUTER_API_KEY".into()],
            port: Box::new(|| PortStatus::LuunaRunning(4242)),
            components: Box::new(|| Err("component toolchain unavailable".into())),
        }
    }

    #[test]
    fn doctor_report_fails_only_on_missing_required_items() {
        let report = doctor_report(&probes(
            Ok("pi 1.3.0 at C:/pi".into()),
            Ok("C:/data exists and is writable".into()),
        ));
        assert!(report.ok, "{report:?}");
        let by_name = |name: &str| report.items.iter().find(|i| i.name == name).unwrap();
        assert_eq!(by_name("python").status, "warning");
        assert_eq!(by_name("github_token").status, "warning");
        assert!(by_name("github_token").detail.contains("not set"));
        assert_eq!(by_name("provider_credentials").status, "ok");
        assert!(by_name("provider_credentials")
            .detail
            .contains("OPENROUTER_API_KEY"));
        assert!(by_name("port").detail.contains("already answers"));
        assert_eq!(by_name("components").status, "warning");
        assert_eq!(
            by_name("database").detail,
            "not created yet; the runtime creates it at first start"
        );
        let json = serde_json::to_value(&report).unwrap();
        assert_eq!(json["ok"], true);
        assert_eq!(json["items"][0]["name"], "git");

        let failed = doctor_report(&probes(
            Err("unsupported Pi version".into()),
            Ok("ok".into()),
        ));
        assert!(!failed.ok);
        assert_eq!(
            failed.items.iter().find(|i| i.name == "pi").unwrap().status,
            "missing"
        );
        let unwritable = doctor_report(&probes(Ok("pi".into()), Err("read-only".into())));
        assert!(!unwritable.ok);
    }

    #[test]
    fn a_damaged_existing_database_fails_the_report() {
        let mut probes = probes(Ok("pi".into()), Ok("ok".into()));
        probes.database = Box::new(|| Err("database failed its integrity check".into()));
        let report = doctor_report(&probes);
        assert!(!report.ok);
        let database = report.items.iter().find(|i| i.name == "database").unwrap();
        assert_eq!(database.status, "missing");
        assert!(!database.required);
    }
}
