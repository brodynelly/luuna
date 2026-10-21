//! Pinned, bounded CLI integration for the independently maintained components.
//!
//! These are native host processes, not a sandbox. Callers choose private,
//! project-scoped workspaces; no developer store is discovered or imported.
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::{Component, Path, PathBuf},
    process::{ExitStatus, Stdio},
    time::Duration,
};
use thiserror::Error;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    process::Command,
};

pub type Result<T> = std::result::Result<T, ComponentError>;
const MAX_STDOUT: usize = 4 * 1024 * 1024;
const MAX_STDERR: usize = 64 * 1024;
const TIMEOUT: Duration = Duration::from_secs(30);
const CLI_BRIDGE: &str = include_str!("../assets/cli-bridge.mjs");

#[derive(Debug, Error)]
pub enum ComponentError {
    #[error(
        "component integration is unavailable; install the pinned component dependencies and Bun"
    )]
    Unavailable,
    #[error(
        "component identity, source checkout or runtime version differs from its immutable pin"
    )]
    Identity,
    #[error("component workspace is invalid or contains links outside its managed data")]
    Workspace,
    #[error("component operation exceeded its deadline and the owned process was stopped")]
    Timeout,
    #[error("component output exceeded its bounded contract")]
    OutputLimit,
    #[error("component returned invalid structured output")]
    Protocol,
    #[error("component refused the requested operation")]
    Refused,
    #[error("component configuration contains executable hooks; managed integration does not authorize them")]
    Hooks,
}

#[derive(Clone, Debug, Deserialize)]
struct Pin {
    path: String,
    package: String,
    #[serde(rename = "sourceVersion")]
    source_version: String,
    repository: String,
    commit: String,
    cli: Cli,
}
#[derive(Clone, Debug, Deserialize)]
struct Cli {
    primary: String,
    short: String,
    legacy: Vec<String>,
    entrypoint: String,
}
#[derive(Deserialize)]
struct Manifest {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    runtime: Runtime,
    components: Vec<Pin>,
}
#[derive(Deserialize)]
struct Runtime {
    name: String,
    version: String,
}

#[derive(Clone, Debug)]
pub struct Components {
    root: PathBuf,
    bun: PathBuf,
    version: String,
    manifest: Value,
    pins: BTreeMap<String, Pin>,
}

impl Components {
    /// Resolve installation paths without reading a developer credential store.
    /// The exact checkout and Bun executable are revalidated before every call.
    pub fn discover() -> Result<Self> {
        let root = std::env::var_os("LUUNA_COMPONENTS_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.."));
        let platform = if cfg!(windows) {
            "windows"
        } else {
            std::env::consts::OS
        };
        let arch = match std::env::consts::ARCH {
            "x86_64" => "x64",
            "aarch64" => "arm64",
            other => other,
        };
        let file = if cfg!(windows) { "bun.exe" } else { "bun" };
        let local = root
            .join(".tools/bun/node_modules/@oven")
            .join(format!("bun-{platform}-{arch}/bin/{file}"));
        let bun = std::env::var_os("LUUNA_BUN")
            .map(PathBuf::from)
            .or_else(|| local.is_file().then_some(local))
            .or_else(|| find_on_path(file))
            .ok_or(ComponentError::Unavailable)?;
        Self::from_root(root, bun)
    }

    pub fn from_root(root: PathBuf, bun: PathBuf) -> Result<Self> {
        let root = root
            .canonicalize()
            .map_err(|_| ComponentError::Unavailable)?;
        let bun = if bun.is_absolute() {
            bun
        } else {
            find_on_path(&bun.to_string_lossy()).ok_or(ComponentError::Unavailable)?
        };
        if !bun.is_file() {
            return Err(ComponentError::Unavailable);
        }
        let bytes = std::fs::read(root.join("components/manifest.json"))
            .map_err(|_| ComponentError::Unavailable)?;
        if bytes.len() > 256 * 1024 {
            return Err(ComponentError::Identity);
        }
        let manifest_value: Value =
            serde_json::from_slice(&bytes).map_err(|_| ComponentError::Identity)?;
        let manifest: Manifest =
            serde_json::from_value(manifest_value.clone()).map_err(|_| ComponentError::Identity)?;
        if manifest.schema_version != 2
            || manifest.runtime.name != "bun"
            || manifest.runtime.version != "1.4.3"
            || manifest.components.len() != 3
        {
            return Err(ComponentError::Identity);
        }
        let mut pins = BTreeMap::new();
        for pin in manifest.components {
            let name = pin
                .cli
                .primary
                .strip_prefix("luuna-")
                .ok_or(ComponentError::Identity)?
                .to_owned();
            if !["missions", "atlas", "beacon"].contains(&name.as_str())
                || pin.path != format!("components/{name}")
                || pin.repository != format!("https://github.com/brodynelly/luuna-{name}.git")
                || pin.package != format!("@luuna/{name}-cli")
                || pin.commit.len() != 40
                || !pin
                    .commit
                    .bytes()
                    .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
                || pin.cli.entrypoint
                    != if name == "atlas" {
                        "src/cli.ts"
                    } else {
                        "src/index.ts"
                    }
                || pins.insert(name, pin).is_some()
            {
                return Err(ComponentError::Identity);
            }
        }
        Ok(Self {
            root,
            bun,
            version: manifest.runtime.version,
            manifest: manifest_value,
            pins,
        })
    }

    /// Invoke only the pinned source entrypoint, with explicit argument arrays.
    /// Raw command arguments, stdout and stderr are never put into error text.
    pub async fn call(&self, component: &str, workspace: &Path, args: &[String]) -> Result<Value> {
        let name = component.strip_prefix("luuna-").unwrap_or(component);
        let pin = self.pins.get(name).ok_or(ComponentError::Identity)?;
        if args.is_empty()
            || args.len() > 128
            || args
                .iter()
                .any(|arg| arg.len() > 256 * 1024 || arg.contains('\0'))
        {
            return Err(ComponentError::Protocol);
        }
        let workspace = prepare_workspace(workspace)?;
        self.validate(pin, &workspace).await?;
        let data_dir = match name {
            "missions" => ".seeds",
            "atlas" => ".mulch",
            _ => ".canopy",
        };
        if args[0] != "init" && !workspace.join(data_dir).is_dir() {
            return Err(ComponentError::Workspace);
        }
        check_data_links(&workspace.join(data_dir), 0, &mut 0)?;
        if name == "missions"
            && args[0] != "init"
            && !workspace.join(".seeds/config.yaml").is_file()
        {
            return Err(ComponentError::Workspace);
        }
        if name == "atlas" && args[0] != "init" {
            let cfg = self
                .invoke(pin, &workspace, &["config".into(), "show".into()])
                .await?;
            if cfg.get("hooks").is_some_and(nonempty_hooks) {
                return Err(ComponentError::Hooks);
            }
        }
        let value = self.invoke(pin, &workspace, args).await?;
        if value.get("success").and_then(Value::as_bool) != Some(true) {
            return Err(ComponentError::Protocol);
        }
        Ok(value)
    }

    async fn validate(&self, pin: &Pin, workspace: &Path) -> Result<()> {
        let version = output(&self.bun, &["--version".into()], workspace, workspace, None).await?;
        if !version.status.success()
            || std::str::from_utf8(&version.stdout).ok().map(str::trim) != Some(&self.version)
        {
            return Err(ComponentError::Identity);
        }
        let directory = self.root.join(&pin.path);
        if !directory.join(".git").exists()
            || !directory.join("node_modules").is_dir()
            || !directory
                .canonicalize()
                .map_err(|_| ComponentError::Identity)?
                .starts_with(&self.root)
        {
            return Err(ComponentError::Unavailable);
        }
        let index = git(
            &self.root,
            &["ls-files", "--stage", "--", &pin.path],
            workspace,
        )
        .await?;
        if index != format!("160000 {} 0\t{}", pin.commit, pin.path) {
            return Err(ComponentError::Identity);
        }
        // Runtime activation consumes a committed distribution, never a local
        // edit to its manifest, submodule URL, or staged/unstaged gitlink.
        git(
            &self.root,
            &[
                "diff",
                "--no-ext-diff",
                "--no-textconv",
                "--ignore-submodules=dirty",
                "--quiet",
                "HEAD",
                "--",
                "components/manifest.json",
                ".gitmodules",
                &pin.path,
            ],
            workspace,
        )
        .await?;
        let committed_manifest = git(
            &self.root,
            &["show", "HEAD:components/manifest.json"],
            workspace,
        )
        .await?;
        if serde_json::from_str::<Value>(&committed_manifest)
            .map_err(|_| ComponentError::Identity)?
            != self.manifest
        {
            return Err(ComponentError::Identity);
        }
        let key = format!("submodule.{}.url", pin.path);
        if git(
            &self.root,
            &["config", "-f", ".gitmodules", "--get", &key],
            workspace,
        )
        .await?
            != pin.repository
            || git(&directory, &["rev-parse", "HEAD"], workspace).await? != pin.commit
            || !git(
                &directory,
                &["status", "--porcelain", "--untracked-files=all"],
                workspace,
            )
            .await?
            .is_empty()
        {
            return Err(ComponentError::Identity);
        }
        let pkg: Value = serde_json::from_slice(
            &std::fs::read(directory.join("package.json")).map_err(|_| ComponentError::Identity)?,
        )
        .map_err(|_| ComponentError::Identity)?;
        if pkg["name"].as_str() != Some(&pin.package)
            || pkg["version"].as_str() != Some(&pin.source_version)
            || [&pin.cli.primary, &pin.cli.short]
                .into_iter()
                .chain(pin.cli.legacy.iter())
                .any(|alias| pkg["bin"][alias].as_str() != Some(&pin.cli.entrypoint))
        {
            return Err(ComponentError::Identity);
        }
        Ok(())
    }

    async fn invoke(&self, pin: &Pin, workspace: &Path, args: &[String]) -> Result<Value> {
        let mut cli_args = args.to_vec();
        if !cli_args.iter().any(|arg| arg == "--json") {
            cli_args.push("--json".into());
        }
        if pin.cli.primary == "luuna-atlas"
            && !cli_args.iter().any(|arg| arg == "--quiet" || arg == "-q")
        {
            cli_args.push("--quiet".into());
        }
        let input = serde_json::to_vec(&serde_json::json!({
            "entrypoint": self.root.join(&pin.path).join(&pin.cli.entrypoint), "args": cli_args
        }))
        .map_err(|_| ComponentError::Protocol)?;
        if input.len() > 1024 * 1024 {
            return Err(ComponentError::OutputLimit);
        }
        let arguments = ["--no-env-file", "--no-install", "--eval", CLI_BRIDGE].map(Into::into);
        let result = output(&self.bun, &arguments, workspace, workspace, Some(&input)).await?;
        if !result.status.success() {
            return Err(ComponentError::Refused);
        }
        serde_json::from_slice(&result.stdout).map_err(|_| ComponentError::Protocol)
    }
}

fn nonempty_hooks(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Object(map) => map.values().any(nonempty_hooks),
        Value::Array(values) => !values.is_empty(),
        _ => true,
    }
}
fn find_on_path(name: &str) -> Option<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH")?)
        .map(|path| path.join(name))
        .find(|path| path.is_file())
}
fn linked(metadata: &std::fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}
fn private_dir(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path).map_err(|_| ComponentError::Workspace)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700))
            .map_err(|_| ComponentError::Workspace)?;
    }
    Ok(())
}
fn prepare_workspace(path: &Path) -> Result<PathBuf> {
    let path = if path.is_absolute() {
        path.to_owned()
    } else {
        std::env::current_dir()
            .map_err(|_| ComponentError::Workspace)?
            .join(path)
    };
    let mut current = PathBuf::new();
    for part in path.components() {
        if matches!(part, Component::ParentDir) {
            return Err(ComponentError::Workspace);
        }
        current.push(part);
        if std::fs::symlink_metadata(&current).is_ok_and(|metadata| linked(&metadata)) {
            return Err(ComponentError::Workspace);
        }
    }
    private_dir(&path)?;
    let path = path.canonicalize().map_err(|_| ComponentError::Workspace)?;
    let home = path.join(".luuna-component-home");
    if std::fs::symlink_metadata(&home).is_ok_and(|metadata| linked(&metadata)) {
        return Err(ComponentError::Workspace);
    }
    private_dir(&home)?;
    check_data_links(&home, 0, &mut 0)?;
    Ok(path)
}
fn check_data_links(path: &Path, depth: usize, count: &mut usize) -> Result<()> {
    let metadata = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(ComponentError::Workspace),
    };
    *count += 1;
    if linked(&metadata) || depth > 16 || *count > 20_000 {
        return Err(ComponentError::Workspace);
    }
    if metadata.is_dir() {
        for entry in std::fs::read_dir(path).map_err(|_| ComponentError::Workspace)? {
            check_data_links(
                &entry.map_err(|_| ComponentError::Workspace)?.path(),
                depth + 1,
                count,
            )?;
        }
    }
    Ok(())
}

async fn git(cwd: &Path, args: &[&str], workspace: &Path) -> Result<String> {
    let mut arguments: Vec<OsString> = [
        "--no-pager",
        "-c",
        "core.fsmonitor=false",
        "-c",
        "core.autocrlf=true",
        "-c",
        if cfg!(windows) {
            "core.hooksPath=NUL"
        } else {
            "core.hooksPath=/dev/null"
        },
    ]
    .into_iter()
    .map(Into::into)
    .collect();
    if matches!(args.first(), Some(&"diff" | &"status")) {
        // A local info/attributes file can select arbitrary configured content
        // filters even when the committed source has no filter attributes.
        // Enumerating keys is read-only and never invokes the filter itself.
        let mut listed_args = arguments.clone();
        listed_args.extend(
            [
                "config",
                "--null",
                "--name-only",
                "--get-regexp",
                r"^filter\.",
            ]
            .map(OsString::from),
        );
        let listed = output(Path::new("git"), &listed_args, cwd, workspace, None).await?;
        if !listed.status.success() && listed.status.code() != Some(1) {
            return Err(ComponentError::Identity);
        }
        let keys = std::str::from_utf8(&listed.stdout).map_err(|_| ComponentError::Identity)?;
        let mut drivers = std::collections::BTreeSet::new();
        for key in keys.split('\0').filter(|key| !key.is_empty()) {
            let driver = key
                .strip_prefix("filter.")
                .and_then(|rest| rest.rsplit_once('.'))
                .map(|(driver, _)| driver)
                .filter(|driver| !driver.is_empty() && driver.len() <= 1024)
                .ok_or(ComponentError::Identity)?;
            drivers.insert(driver);
            if drivers.len() > 128 {
                return Err(ComponentError::Identity);
            }
        }
        for driver in drivers {
            for setting in ["clean=", "smudge=", "process=", "required=false"] {
                arguments.push("-c".into());
                arguments.push(format!("filter.{driver}.{setting}").into());
            }
        }
    }
    arguments.extend(args.iter().map(OsString::from));
    let result = output(Path::new("git"), &arguments, cwd, workspace, None).await?;
    if !result.status.success() {
        return Err(ComponentError::Identity);
    }
    String::from_utf8(result.stdout)
        .map(|value| value.trim().to_owned())
        .map_err(|_| ComponentError::Identity)
}

struct Captured {
    status: ExitStatus,
    stdout: Vec<u8>,
}
async fn bounded(mut stream: impl tokio::io::AsyncRead + Unpin, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    // Two readers remain inside the captured process future while a request is
    // pending. Keep their buffers off native thread stacks, including debug
    // builds where nested async state is copied through request middleware.
    let mut chunk = vec![0_u8; 8192];
    loop {
        let read = stream
            .read(&mut chunk)
            .await
            .map_err(|_| ComponentError::Protocol)?;
        if read == 0 {
            return Ok(bytes);
        }
        if bytes.len() + read > limit {
            return Err(ComponentError::OutputLimit);
        }
        bytes.extend_from_slice(&chunk[..read]);
    }
}
async fn output(
    program: &Path,
    args: &[OsString],
    cwd: &Path,
    workspace: &Path,
    input: Option<&[u8]>,
) -> Result<Captured> {
    output_with_deadline(program, args, cwd, workspace, input, TIMEOUT).await
}
async fn output_with_deadline(
    program: &Path,
    args: &[OsString],
    cwd: &Path,
    workspace: &Path,
    input: Option<&[u8]>,
    deadline: Duration,
) -> Result<Captured> {
    let home = workspace.join(".luuna-component-home");
    let mut command = Command::new(program);
    command
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for name in [
        "PATH",
        "SystemRoot",
        "WINDIR",
        "COMSPEC",
        "PATHEXT",
        "TEMP",
        "TMP",
        "TMPDIR",
    ] {
        if let Some(value) = std::env::var_os(name) {
            command.env(name, value);
        }
    }
    command
        .env("HOME", &home)
        .env("USERPROFILE", &home)
        .env("XDG_CONFIG_HOME", &home)
        .env("APPDATA", &home)
        .env("LOCALAPPDATA", &home)
        .env("NO_COLOR", "1")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env(
            "GIT_CONFIG_GLOBAL",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        // Git ignores a ceiling equal to its starting directory. Stop before
        // entering the managed workspace's parent, which can be a source repo.
        .env(
            "GIT_CEILING_DIRECTORIES",
            workspace.parent().ok_or(ComponentError::Workspace)?,
        )
        .env("GIT_CONFIG_COUNT", "2")
        .env("GIT_CONFIG_KEY_0", "core.fsmonitor")
        .env("GIT_CONFIG_VALUE_0", "false")
        .env("GIT_CONFIG_KEY_1", "core.hooksPath")
        .env(
            "GIT_CONFIG_VALUE_1",
            if cfg!(windows) { "NUL" } else { "/dev/null" },
        )
        .env("BUN_RUNTIME_TRANSPILER_CACHE_PATH", home.join("bun-cache"));
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|_| ComponentError::Unavailable)?;
    let owner = ProcessOwner::new(&child)?;
    let stdin = child.stdin.take();
    let stdout = child.stdout.take().ok_or(ComponentError::Unavailable)?;
    let stderr = child.stderr.take().ok_or(ComponentError::Unavailable)?;
    let capture = async {
        let (status, stdout, _, _) = tokio::try_join!(
            async { child.wait().await.map_err(|_| ComponentError::Unavailable) },
            bounded(stdout, MAX_STDOUT),
            bounded(stderr, MAX_STDERR),
            async {
                if let (Some(mut stdin), Some(input)) = (stdin, input) {
                    stdin
                        .write_all(input)
                        .await
                        .map_err(|_| ComponentError::Protocol)?;
                    stdin
                        .shutdown()
                        .await
                        .map_err(|_| ComponentError::Protocol)?;
                }
                Ok::<(), ComponentError>(())
            }
        )?;
        Ok(Captured { status, stdout })
    };
    let result = tokio::time::timeout(deadline, capture).await;
    drop(owner); // Ends all owned descendants before any error/result is returned.
    if !matches!(result, Ok(Ok(_))) {
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(5), child.wait()).await;
    }
    result.map_err(|_| ComponentError::Timeout)?
}

#[cfg(unix)]
struct ProcessOwner {
    group: Option<u32>,
}
#[cfg(unix)]
impl ProcessOwner {
    fn new(child: &tokio::process::Child) -> Result<Self> {
        Ok(Self { group: child.id() })
    }
}
#[cfg(unix)]
impl Drop for ProcessOwner {
    fn drop(&mut self) {
        if let Some(group) = self.group {
            unsafe {
                libc::killpg(group as libc::pid_t, libc::SIGKILL);
            }
        }
    }
}

#[cfg(windows)]
struct ProcessOwner {
    job: windows_sys::Win32::Foundation::HANDLE,
}
#[cfg(windows)]
impl ProcessOwner {
    fn new(child: &tokio::process::Child) -> Result<Self> {
        use windows_sys::Win32::{Foundation::CloseHandle, System::JobObjects::*};
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() {
            return Err(ComponentError::Unavailable);
        }
        let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        let Some(process) = child.raw_handle() else {
            unsafe {
                CloseHandle(job);
            }
            return Err(ComponentError::Unavailable);
        };
        let configured = unsafe {
            SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            )
        };
        if configured == 0 || unsafe { AssignProcessToJobObject(job, process as _) } == 0 {
            unsafe {
                CloseHandle(job);
            }
            return Err(ComponentError::Unavailable);
        }
        Ok(Self { job })
    }
}
#[cfg(windows)]
impl Drop for ProcessOwner {
    fn drop(&mut self) {
        unsafe {
            windows_sys::Win32::Foundation::CloseHandle(self.job);
        }
    }
}
#[cfg(windows)]
unsafe impl Send for ProcessOwner {}

#[cfg(not(any(unix, windows)))]
compile_error!("component process ownership is implemented only for Unix and Windows");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn component_futures_fit_small_native_thread_stacks() {
        let runner = Components {
            root: PathBuf::new(),
            bun: PathBuf::new(),
            version: "1.4.3".into(),
            manifest: Value::Null,
            pins: BTreeMap::new(),
        };
        let args = ["list".into()];
        let call = runner.call("atlas", Path::new("unused"), &args);
        let read = bounded(tokio::io::empty(), MAX_STDOUT);
        let call_bytes = std::mem::size_of_val(&call);
        let read_bytes = std::mem::size_of_val(&read);
        eprintln!(
            "component call future: {call_bytes} bytes; bounded read future: {read_bytes} bytes"
        );
        assert!(read_bytes <= 1024, "read buffers must stay on the heap");
        assert!(
            call_bytes <= 4096,
            "component calls must not inflate native request stacks"
        );
    }

    fn node() -> PathBuf {
        find_on_path(if cfg!(windows) { "node.exe" } else { "node" })
            .expect("Node is a repository prerequisite")
    }

    #[tokio::test]
    async fn component_capture_strips_credentials_and_uses_a_private_home() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = prepare_workspace(&dir.path().canonicalize().unwrap()).unwrap();
        std::env::set_var("LUUNA_COMPONENT_TEST_SECRET", "synthetic-test-only");
        let code = "process.stdout.write(JSON.stringify({secret:process.env.LUUNA_COMPONENT_TEST_SECRET??null,home:process.env.HOME,git:process.env.GIT_CONFIG_GLOBAL}))";
        let result = output(
            &node(),
            &["-e".into(), code.into()],
            &workspace,
            &workspace,
            None,
        )
        .await
        .unwrap();
        std::env::remove_var("LUUNA_COMPONENT_TEST_SECRET");
        let value: Value = serde_json::from_slice(&result.stdout).unwrap();
        assert!(result.status.success());
        assert!(value["secret"].is_null());
        assert_eq!(
            PathBuf::from(value["home"].as_str().unwrap()),
            workspace.join(".luuna-component-home")
        );
        assert_eq!(
            value["git"],
            if cfg!(windows) { "NUL" } else { "/dev/null" }
        );
    }

    #[tokio::test]
    async fn oversized_output_is_rejected_and_the_child_is_reaped() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = prepare_workspace(&dir.path().canonicalize().unwrap()).unwrap();
        let result = output(
            &node(),
            &[
                "-e".into(),
                "process.stdout.write('x'.repeat(5*1024*1024));setInterval(()=>{},1000)".into(),
            ],
            &workspace,
            &workspace,
            None,
        )
        .await;
        assert!(matches!(result, Err(ComponentError::OutputLimit)));
    }

    #[tokio::test]
    async fn git_children_cannot_discover_a_parent_repository_or_use_local_hooks() {
        let parent = tempfile::tempdir().unwrap();
        let parent = parent.path().canonicalize().unwrap();
        let workspace = prepare_workspace(&parent.join("managed")).unwrap();
        let initialized = output(
            Path::new("git"),
            &["init".into(), "--quiet".into()],
            &parent,
            &workspace,
            None,
        )
        .await
        .unwrap();
        assert!(initialized.status.success());
        let discovered = output(
            Path::new("git"),
            &["rev-parse".into(), "--show-toplevel".into()],
            &workspace,
            &workspace,
            None,
        )
        .await
        .unwrap();
        assert!(!discovered.status.success());
        std::fs::write(
            parent.join(".git/config"),
            "[core]\nfsmonitor = synthetic-untrusted-command\nhooksPath = synthetic-untrusted-hooks\n",
        )
        .unwrap();
        for (key, expected) in [
            ("core.fsmonitor", "false"),
            (
                "core.hooksPath",
                if cfg!(windows) { "NUL" } else { "/dev/null" },
            ),
        ] {
            let config = output(
                Path::new("git"),
                &["config".into(), "--get".into(), key.into()],
                &parent,
                &workspace,
                None,
            )
            .await
            .unwrap();
            assert!(config.status.success());
            assert_eq!(String::from_utf8(config.stdout).unwrap().trim(), expected);
        }
    }

    #[tokio::test]
    async fn source_identity_probes_never_execute_configured_content_filters() {
        let parent = tempfile::tempdir().unwrap();
        let parent = parent.path().canonicalize().unwrap();
        let workspace = prepare_workspace(&parent.join("managed")).unwrap();
        git(&parent, &["init", "--quiet"], &workspace)
            .await
            .unwrap();
        std::fs::write(parent.join("tracked.txt"), "before\n").unwrap();
        git(&parent, &["add", "tracked.txt"], &workspace)
            .await
            .unwrap();
        git(
            &parent,
            &[
                "config",
                "filter.synthetic.clean",
                "node -e \"require('fs').writeFileSync('filter-ran','synthetic')\"",
            ],
            &workspace,
        )
        .await
        .unwrap();
        git(
            &parent,
            &["config", "filter.synthetic.required", "true"],
            &workspace,
        )
        .await
        .unwrap();
        std::fs::write(
            parent.join(".git/info/attributes"),
            "tracked.txt filter=synthetic\n",
        )
        .unwrap();
        std::fs::write(parent.join("tracked.txt"), "after has different length\n").unwrap();
        let status = git(&parent, &["status", "--porcelain"], &workspace)
            .await
            .unwrap();
        assert!(status.contains("tracked.txt"));
        assert!(!parent.join("filter-ran").exists());
    }

    #[tokio::test]
    async fn deadline_stops_the_owned_descendant_tree() {
        let dir = tempfile::tempdir().unwrap();
        let workspace = prepare_workspace(&dir.path().canonicalize().unwrap()).unwrap();
        let file = workspace.join("descendant.pid");
        let code = format!("const c=require('child_process').spawn(process.execPath,['-e','setInterval(()=>{{}},1000)'],{{stdio:'ignore'}});require('fs').writeFileSync({},String(c.pid));setInterval(()=>{{}},1000)", serde_json::to_string(&file).unwrap());
        let result = output_with_deadline(
            &node(),
            &["-e".into(), code.into()],
            &workspace,
            &workspace,
            None,
            Duration::from_secs(1),
        )
        .await;
        assert!(matches!(result, Err(ComponentError::Timeout)));
        let pid = std::fs::read_to_string(file)
            .unwrap()
            .parse::<u32>()
            .unwrap();
        let probe = format!("let alive=false;try{{process.kill({pid},0);alive=true}}catch{{}};if(process.platform==='linux'&&alive){{try{{alive=require('fs').readFileSync('/proc/{pid}/stat','utf8').split(') ')[1][0]!=='Z'}}catch{{alive=false}}}};process.stdout.write(JSON.stringify(alive))");
        tokio::time::sleep(Duration::from_millis(100)).await;
        let result = output(
            &node(),
            &["-e".into(), probe.into()],
            &workspace,
            &workspace,
            None,
        )
        .await
        .unwrap();
        assert_eq!(result.stdout, b"false");
    }

    #[test]
    fn links_and_parent_traversal_in_workspaces_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().canonicalize().unwrap();
        std::fs::create_dir(root.join("outside")).unwrap();
        let code = format!(
            "require('fs').symlinkSync({},{},process.platform==='win32'?'junction':'dir')",
            serde_json::to_string(&root.join("outside")).unwrap(),
            serde_json::to_string(&root.join("link")).unwrap()
        );
        assert!(std::process::Command::new(node())
            .args(["-e", &code])
            .status()
            .unwrap()
            .success());
        assert!(matches!(
            prepare_workspace(&root.join("link/data")),
            Err(ComponentError::Workspace)
        ));
        assert!(matches!(
            prepare_workspace(Path::new("../synthetic-component-outside")),
            Err(ComponentError::Workspace)
        ));
    }
}
