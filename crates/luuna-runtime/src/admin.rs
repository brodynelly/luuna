//! Offline maintenance commands for the runtime's data directory (ADR 0016):
//!
//! - `luuna-runtime backup --output <file>` writes a consistent snapshot of the
//!   database while the runtime may be running;
//! - `luuna-runtime restore --input <file>` installs a verified snapshot and
//!   requires the runtime to be stopped;
//! - `luuna-runtime check` reports the database's integrity and schema version.
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
       luuna-runtime check [--data-dir <dir>]";

/// Run a maintenance command named by the first argument. `None` means the
/// arguments name no such command and the service should start as usual.
pub fn dispatch(arguments: impl IntoIterator<Item = OsString>) -> Option<Outcome> {
    let mut arguments = arguments.into_iter();
    let command = arguments.next()?;
    let command = match command.to_str() {
        Some(name @ ("backup" | "restore" | "check")) => name.to_owned(),
        _ => return None,
    };
    let outcome = parse(arguments.collect()).and_then(|options| match command.as_str() {
        "backup" => backup(&options),
        "restore" => restore(&options),
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
}

fn parse(arguments: Vec<OsString>) -> Result<Options, Box<dyn std::error::Error>> {
    let mut options = Options {
        data_dir: default_data_dir()?,
        output: None,
        input: None,
    };
    let mut arguments = arguments.into_iter();
    while let Some(flag) = arguments.next() {
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
    }
}
