//! Windows: run the command in an AppContainer (a low-box token, as store apps
//! use). An AppContainer process can open only objects whose access-control list
//! grants its SID or `ALL APPLICATION PACKAGES` (which Windows grants on system
//! directories). The launcher grants the container's SID read-write on the
//! repositories, the sandbox home and the synthetic root of junctions, and
//! read-execute on toolchain directories in the user profile; the rest of the
//! profile stays unreadable. The child runs in a kill-on-close job object.
use crate::{display, sandbox_environment, toolchain_dirs, Network, SandboxError, SandboxPlan};
use std::{
    ffi::{c_void, OsStr},
    os::windows::ffi::OsStrExt,
    path::{Path, PathBuf},
    ptr::{null, null_mut},
};
use windows_sys::Win32::{
    Foundation::{CloseHandle, LocalFree, ERROR_SUCCESS, HANDLE},
    Security::{
        AclSizeInformation,
        Authorization::{
            ConvertStringSidToSidW, GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW,
            EXPLICIT_ACCESS_W, GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, REVOKE_ACCESS, SE_FILE_OBJECT,
            TRUSTEE_IS_SID, TRUSTEE_IS_WELL_KNOWN_GROUP, TRUSTEE_W,
        },
        EqualSid, FreeSid, GetAce, GetAclInformation,
        Isolation::{
            CreateAppContainerProfile, DeleteAppContainerProfile,
            DeriveAppContainerSidFromAppContainerName,
        },
        ACCESS_ALLOWED_ACE, ACE_HEADER, ACL, ACL_SIZE_INFORMATION, CONTAINER_INHERIT_ACE,
        DACL_SECURITY_INFORMATION, OBJECT_INHERIT_ACE, PSECURITY_DESCRIPTOR, PSID,
        SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES, SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    },
    Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ},
    System::{
        Console::SetConsoleCtrlHandler,
        JobObjects::{
            AssignProcessToJobObject, CreateJobObjectW, JobObjectExtendedLimitInformation,
            SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
            JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        },
        SystemServices::{ACCESS_ALLOWED_ACE_TYPE, SE_GROUP_ENABLED},
        Threading::{
            CreateProcessW, DeleteProcThreadAttributeList, GetExitCodeProcess,
            InitializeProcThreadAttributeList, ResumeThread, UpdateProcThreadAttribute,
            WaitForSingleObject, CREATE_SUSPENDED, CREATE_UNICODE_ENVIRONMENT,
            EXTENDED_STARTUPINFO_PRESENT, INFINITE, LPPROC_THREAD_ATTRIBUTE_LIST,
            PROCESS_INFORMATION, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES, STARTUPINFOEXW,
        },
    },
};

/// `HRESULT_FROM_WIN32(ERROR_ALREADY_EXISTS)`: the profile was created before.
const PROFILE_EXISTS: i32 = 0x800700B7u32 as i32;
/// The `internetClient` capability: outbound network access.
const INTERNET_CLIENT: &str = "S-1-15-3-1";
const READ_WRITE: u32 = FILE_ALL_ACCESS;
const READ_EXECUTE: u32 = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;

fn wide(text: impl AsRef<OsStr>) -> Vec<u16> {
    text.as_ref()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn platform(what: &str, code: impl std::fmt::Display) -> SandboxError {
    SandboxError::Platform(format!("{what} failed ({code})"))
}

/// A SID and the function that frees it.
struct Sid {
    sid: PSID,
    local: bool,
}

impl Drop for Sid {
    fn drop(&mut self) {
        if self.sid.is_null() {
            return;
        }
        // SAFETY: the SID came from the API named by `local`, which documents
        // the matching release function, and is released exactly once.
        unsafe {
            if self.local {
                LocalFree(self.sid);
            } else {
                FreeSid(self.sid);
            }
        }
    }
}

/// The project's AppContainer SID, creating the profile on first use.
fn container_sid(name: &str, project_id: &str) -> Result<Sid, SandboxError> {
    let name_w = wide(name);
    let display_w = wide(format!("Luuna sandbox {project_id}"));
    let mut sid: PSID = null_mut();
    // SAFETY: valid NUL-terminated strings; `sid` receives an allocation that
    // `Sid` frees with FreeSid.
    let created = unsafe {
        CreateAppContainerProfile(
            name_w.as_ptr(),
            display_w.as_ptr(),
            display_w.as_ptr(),
            null(),
            0,
            &mut sid,
        )
    };
    if created >= 0 {
        return Ok(Sid { sid, local: false });
    }
    if created != PROFILE_EXISTS {
        return Err(platform(
            "CreateAppContainerProfile",
            format!("{created:#x}"),
        ));
    }
    // SAFETY: as above.
    let derived = unsafe { DeriveAppContainerSidFromAppContainerName(name_w.as_ptr(), &mut sid) };
    if derived < 0 {
        return Err(platform(
            "DeriveAppContainerSidFromAppContainerName",
            format!("{derived:#x}"),
        ));
    }
    Ok(Sid { sid, local: false })
}

fn string_sid(text: &str) -> Result<Sid, SandboxError> {
    let text_w = wide(text);
    let mut sid: PSID = null_mut();
    // SAFETY: valid string; the SID is LocalAlloc'd and freed by `Sid`.
    if unsafe { ConvertStringSidToSidW(text_w.as_ptr(), &mut sid) } == 0 {
        return Err(platform(
            "ConvertStringSidToSidW",
            std::io::Error::last_os_error(),
        ));
    }
    Ok(Sid { sid, local: true })
}

/// A file's DACL, freed with its security descriptor.
struct Dacl {
    dacl: *mut ACL,
    descriptor: PSECURITY_DESCRIPTOR,
}

impl Drop for Dacl {
    fn drop(&mut self) {
        // SAFETY: GetNamedSecurityInfoW allocated the descriptor with LocalAlloc.
        unsafe { LocalFree(self.descriptor) };
    }
}

fn dacl_of(path: &[u16]) -> Result<Dacl, SandboxError> {
    let mut dacl: *mut ACL = null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = null_mut();
    // SAFETY: `path` is NUL-terminated; out-pointers are valid.
    let status = unsafe {
        GetNamedSecurityInfoW(
            path.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            &mut dacl,
            null_mut(),
            &mut descriptor,
        )
    };
    if status != ERROR_SUCCESS {
        return Err(platform(
            "GetNamedSecurityInfoW",
            std::io::Error::from_raw_os_error(status as i32),
        ));
    }
    Ok(Dacl { dacl, descriptor })
}

/// Whether `path` already carries an inheritable allow entry for `sid`
/// covering `mask`.
fn granted(path: &Path, sid: &Sid, mask: u32) -> Result<bool, SandboxError> {
    let dacl = dacl_of(&wide(path))?;
    if dacl.dacl.is_null() {
        // A null DACL grants everyone everything.
        return Ok(true);
    }
    let mut info = ACL_SIZE_INFORMATION {
        AceCount: 0,
        AclBytesInUse: 0,
        AclBytesFree: 0,
    };
    // SAFETY: `dacl.dacl` is a valid ACL owned by `dacl` for this scope.
    let ok = unsafe {
        GetAclInformation(
            dacl.dacl,
            (&mut info as *mut ACL_SIZE_INFORMATION).cast::<c_void>(),
            std::mem::size_of::<ACL_SIZE_INFORMATION>() as u32,
            AclSizeInformation,
        )
    };
    if ok == 0 {
        return Err(platform(
            "GetAclInformation",
            std::io::Error::last_os_error(),
        ));
    }
    let inherit = (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE) as u8;
    for index in 0..info.AceCount {
        let mut ace: *mut c_void = null_mut();
        // SAFETY: index is below AceCount; GetAce returns a pointer into the ACL.
        if unsafe { GetAce(dacl.dacl, index, &mut ace) } == 0 {
            continue;
        }
        // SAFETY: every ACE starts with an ACE_HEADER; ACCESS_ALLOWED_ACE is
        // the layout of type 0 entries, whose SID starts at SidStart.
        unsafe {
            let header = &*(ace as *const ACE_HEADER);
            if u32::from(header.AceType) != ACCESS_ALLOWED_ACE_TYPE
                || header.AceFlags & inherit != inherit
            {
                continue;
            }
            let allowed = &*(ace as *const ACCESS_ALLOWED_ACE);
            let ace_sid = (&allowed.SidStart as *const u32)
                .cast_mut()
                .cast::<c_void>();
            if EqualSid(ace_sid, sid.sid) != 0 && allowed.Mask & mask == mask {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

/// Grant (or revoke) `sid` on `path` with inheritance; Windows propagates the
/// entry to every existing child, which is what makes it slow on a first grant.
fn set_entry(path: &Path, sid: &Sid, mask: u32, grant: bool) -> Result<(), SandboxError> {
    let path_w = wide(path);
    let old = dacl_of(&path_w)?;
    let entry = EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: if grant { GRANT_ACCESS } else { REVOKE_ACCESS },
        grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_WELL_KNOWN_GROUP,
            ptstrName: sid.sid.cast::<u16>(),
        },
    };
    let mut new: *mut ACL = null_mut();
    // SAFETY: one valid entry; `old.dacl` may be null (SetEntriesInAclW accepts it).
    let status = unsafe { SetEntriesInAclW(1, &entry, old.dacl, &mut new) };
    if status != ERROR_SUCCESS {
        return Err(platform(
            "SetEntriesInAclW",
            std::io::Error::from_raw_os_error(status as i32),
        ));
    }
    // SAFETY: `new` is a valid ACL from SetEntriesInAclW, freed below.
    let status = unsafe {
        SetNamedSecurityInfoW(
            path_w.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            null_mut(),
            null_mut(),
            new,
            null(),
        )
    };
    // SAFETY: allocated by SetEntriesInAclW with LocalAlloc.
    unsafe { LocalFree(new.cast::<c_void>()) };
    if status != ERROR_SUCCESS {
        return Err(SandboxError::Platform(format!(
            "cannot change the access list of {}: {}",
            path.display(),
            std::io::Error::from_raw_os_error(status as i32)
        )));
    }
    Ok(())
}

fn ensure_grant(path: &Path, sid: &Sid, mask: u32, label: &str) -> Result<(), SandboxError> {
    if granted(path, sid, mask)? {
        return Ok(());
    }
    eprintln!("luuna-sbx: granting the sandbox {label} access to {} (the first time can take a while on a large folder)…", path.display());
    set_entry(path, sid, mask, true)
}

/// One junction `<root>\<id>` per repository; stale entries are removed.
fn junctions(plan: &SandboxPlan, root: &Path) -> Result<(), SandboxError> {
    std::fs::create_dir_all(root)?;
    let wanted: Vec<(PathBuf, PathBuf)> = plan
        .repositories
        .iter()
        .map(|r| (root.join(&r.repository_id), PathBuf::from(&r.host_path)))
        .collect();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        let link = std::fs::symlink_metadata(&path)?.file_type().is_symlink();
        let current = wanted.iter().find(|(at, _)| *at == path);
        let fresh = current.is_some_and(|(_, target)| {
            std::fs::read_link(&path).is_ok_and(|t| PathBuf::from(display(&t)) == *target)
        });
        if link && !fresh {
            // Removes the junction itself, never its target.
            std::fs::remove_dir(&path)?;
        }
    }
    for (at, target) in &wanted {
        if std::fs::symlink_metadata(at).is_ok() {
            continue;
        }
        let made = std::process::Command::new("cmd.exe")
            .args(["/d", "/c", "mklink", "/J"])
            .arg(at)
            .arg(target)
            .stdout(std::process::Stdio::null())
            .status()?;
        if !made.success() {
            return Err(SandboxError::Platform(format!(
                "cannot create the junction {} -> {}",
                at.display(),
                target.display()
            )));
        }
    }
    Ok(())
}

/// Directories the plan grants read-write.
fn writable(plan: &SandboxPlan) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = plan
        .repositories
        .iter()
        .map(|r| PathBuf::from(&r.host_path))
        .collect();
    out.push(PathBuf::from(&plan.home));
    if let Some(root) = &plan.host_root {
        out.push(PathBuf::from(root));
    }
    out
}

/// Toolchain directories on `PATH` inside the user profile; directories
/// elsewhere (Windows, Program Files) are already readable by every container.
fn toolchains(plan: &SandboxPlan, extra: &[PathBuf]) -> Vec<PathBuf> {
    let profile = std::env::var("USERPROFILE").unwrap_or_default();
    let mut dirs: Vec<PathBuf> = toolchain_dirs(plan, &[], &[])
        .into_iter()
        .filter(|d| !profile.is_empty() && d.starts_with(&profile))
        .collect();
    dirs.extend(extra.iter().cloned());
    dirs
}

/// Grant everything the plan needs; idempotent.
pub fn prepare(plan: &SandboxPlan, extra_read: &[PathBuf]) -> Result<(), SandboxError> {
    let name = plan.container_name.as_deref().ok_or_else(|| {
        SandboxError::InvalidPlan("an AppContainer plan needs a container name".into())
    })?;
    let sid = container_sid(name, &plan.project_id)?;
    let home = PathBuf::from(&plan.home);
    for leaf in ["", r"AppData\Roaming", r"AppData\Local", "Temp"] {
        std::fs::create_dir_all(home.join(leaf))?;
    }
    let root =
        PathBuf::from(plan.host_root.as_deref().ok_or_else(|| {
            SandboxError::InvalidPlan("an AppContainer plan needs a root".into())
        })?);
    std::fs::create_dir_all(&root)?;
    for path in writable(plan) {
        if !path.is_dir() {
            return Err(SandboxError::Unavailable(format!(
                "{} is not a directory; run orbit sync",
                path.display()
            )));
        }
        ensure_grant(&path, &sid, READ_WRITE, "read-write")?;
    }
    junctions(plan, &root)?;
    for dir in toolchains(plan, extra_read) {
        if dir.is_dir() {
            ensure_grant(&dir, &sid, READ_EXECUTE, "read-execute")?;
        }
    }
    Ok(())
}

/// Remove every entry granted for this project's container, then the
/// container profile itself.
pub fn revoke(plan: &SandboxPlan, extra_read: &[PathBuf]) -> Result<(), SandboxError> {
    let name = plan.container_name.as_deref().ok_or_else(|| {
        SandboxError::InvalidPlan("an AppContainer plan needs a container name".into())
    })?;
    let sid = container_sid(name, &plan.project_id)?;
    for path in writable(plan)
        .into_iter()
        .chain(toolchains(plan, extra_read))
    {
        if path.is_dir() && granted(&path, &sid, 0)? {
            eprintln!(
                "luuna-sbx: removing the sandbox's access to {}…",
                path.display()
            );
            set_entry(&path, &sid, READ_WRITE, false)?;
        }
    }
    drop(sid);
    let name_w = wide(name);
    // SAFETY: a valid NUL-terminated profile name.
    let deleted = unsafe { DeleteAppContainerProfile(name_w.as_ptr()) };
    if deleted < 0 {
        return Err(platform(
            "DeleteAppContainerProfile",
            format!("{deleted:#x}"),
        ));
    }
    Ok(())
}

/// Quote one argument the way the Microsoft C runtime parses it back.
pub fn quote(argument: &str) -> String {
    if !argument.is_empty() && !argument.contains([' ', '\t', '\n', '\u{b}', '"']) {
        return argument.to_owned();
    }
    let mut out = String::from('"');
    let mut backslashes = 0usize;
    for c in argument.chars() {
        match c {
            '\\' => backslashes += 1,
            '"' => {
                out.push_str(&"\\".repeat(backslashes * 2 + 1));
                out.push('"');
                backslashes = 0;
            }
            _ => {
                out.push_str(&"\\".repeat(backslashes));
                out.push(c);
                backslashes = 0;
            }
        }
    }
    out.push_str(&"\\".repeat(backslashes * 2));
    out.push('"');
    out
}

/// The command line: a batch launcher (an npm `.cmd` shim) runs through cmd.exe,
/// which CreateProcess cannot start directly. No command opens PowerShell on a
/// `Luuna:` drive rooted at `workdir`: an AppContainer cannot read the drive
/// root, so Windows PowerShell treats every `C:` path as missing, while a drive
/// rooted inside the sandbox works.
pub fn command_line(command: &[String], workdir: &str) -> String {
    let mut argv: Vec<String> = if command.is_empty() {
        vec![
            "powershell.exe".into(),
            "-NoLogo".into(),
            "-NoProfile".into(),
            "-NoExit".into(),
            "-Command".into(),
            format!(
                "New-PSDrive -Name Luuna -PSProvider FileSystem -Root '{}' | Out-Null; Set-Location Luuna:\\",
                workdir.replace('\'', "''")
            ),
        ]
    } else {
        command.to_vec()
    };
    let batch = crate::find_on_path(&argv[0]).is_some_and(|p| {
        p.extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("cmd") || e.eq_ignore_ascii_case("bat"))
    });
    if batch {
        argv.splice(0..0, ["cmd.exe".to_owned(), "/d".into(), "/c".into()]);
    }
    argv.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ")
}

fn environment_block(plan: &SandboxPlan) -> Vec<u16> {
    let mut env = sandbox_environment(plan, &plan.home);
    env.sort_by_key(|(k, _)| k.to_ascii_uppercase());
    let mut block: Vec<u16> = Vec::new();
    for (key, value) in env {
        if key.is_empty() || key.contains('=') {
            continue;
        }
        block.extend(OsStr::new(&format!("{key}={value}")).encode_wide());
        block.push(0);
    }
    block.push(0);
    block
}

unsafe extern "system" fn ignore_console_break(_: u32) -> windows_sys::core::BOOL {
    // The child shares this console and handles Ctrl+C itself; the launcher
    // must stay alive, because closing its job object would end the child.
    1
}

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        if !self.0.is_null() {
            // SAFETY: an owned handle closed once.
            unsafe { CloseHandle(self.0) };
        }
    }
}

/// Prepare the grants, then run `command` in the AppContainer with the console
/// attached; returns its exit code.
pub fn run(
    plan: &SandboxPlan,
    command: &[String],
    extra_read: &[PathBuf],
) -> Result<i32, SandboxError> {
    prepare(plan, extra_read)?;
    let name = plan.container_name.as_deref().unwrap_or_default();
    let sid = container_sid(name, &plan.project_id)?;
    let internet = string_sid(INTERNET_CLIENT)?;
    let mut capabilities = [SID_AND_ATTRIBUTES {
        Sid: internet.sid,
        Attributes: SE_GROUP_ENABLED as u32,
    }];
    let mut security = SECURITY_CAPABILITIES {
        AppContainerSid: sid.sid,
        Capabilities: if plan.network == Network::Open {
            capabilities.as_mut_ptr()
        } else {
            null_mut()
        },
        CapabilityCount: u32::from(plan.network == Network::Open),
        Reserved: 0,
    };
    // SAFETY: the size query writes only `size`; the list buffer is then
    // allocated with that size, initialized, used and deleted in this scope.
    unsafe {
        let mut size = 0usize;
        InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut size);
        let mut buffer = vec![0u8; size];
        let list = buffer.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
        if InitializeProcThreadAttributeList(list, 1, 0, &mut size) == 0 {
            return Err(platform(
                "InitializeProcThreadAttributeList",
                std::io::Error::last_os_error(),
            ));
        }
        let updated = UpdateProcThreadAttribute(
            list,
            0,
            PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize,
            (&mut security as *mut SECURITY_CAPABILITIES).cast::<c_void>(),
            std::mem::size_of::<SECURITY_CAPABILITIES>(),
            null_mut(),
            null(),
        );
        if updated == 0 {
            DeleteProcThreadAttributeList(list);
            return Err(platform(
                "UpdateProcThreadAttribute",
                std::io::Error::last_os_error(),
            ));
        }
        let mut startup: STARTUPINFOEXW = std::mem::zeroed();
        startup.StartupInfo.cb = std::mem::size_of::<STARTUPINFOEXW>() as u32;
        startup.lpAttributeList = list;
        let mut info: PROCESS_INFORMATION = std::mem::zeroed();
        let mut line = wide(command_line(command, &plan.workdir));
        let environment = environment_block(plan);
        let workdir = wide(&plan.workdir);
        let created = CreateProcessW(
            null(),
            line.as_mut_ptr(),
            null(),
            null(),
            0,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_SUSPENDED,
            environment.as_ptr().cast::<c_void>(),
            workdir.as_ptr(),
            &startup.StartupInfo,
            &mut info,
        );
        let error = std::io::Error::last_os_error();
        DeleteProcThreadAttributeList(list);
        if created == 0 {
            return Err(SandboxError::Platform(format!(
                "cannot start {}: {error}",
                command_line(command, &plan.workdir)
            )));
        }
        let process = Handle(info.hProcess);
        let thread = Handle(info.hThread);
        let job = Handle(CreateJobObjectW(null(), null()));
        if job.0.is_null() {
            return Err(platform(
                "CreateJobObjectW",
                std::io::Error::last_os_error(),
            ));
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(
            job.0,
            JobObjectExtendedLimitInformation,
            (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast::<c_void>(),
            std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
        );
        if AssignProcessToJobObject(job.0, process.0) == 0 {
            return Err(platform(
                "AssignProcessToJobObject",
                std::io::Error::last_os_error(),
            ));
        }
        SetConsoleCtrlHandler(Some(ignore_console_break), 1);
        ResumeThread(thread.0);
        WaitForSingleObject(process.0, INFINITE);
        let mut code = 1u32;
        GetExitCodeProcess(process.0, &mut code);
        drop(job);
        Ok(code as i32)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_like_the_c_runtime() {
        assert_eq!(quote("plain"), "plain");
        assert_eq!(quote("two words"), "\"two words\"");
        assert_eq!(quote(""), "\"\"");
        assert_eq!(quote(r#"say "hi""#), r#""say \"hi\"""#);
        assert_eq!(quote(r"C:\dir with space\"), r#""C:\dir with space\\""#);
    }

    #[test]
    fn no_command_opens_powershell_without_a_profile() {
        assert_eq!(
            command_line(&[], r"C:\data\root"),
            r#"powershell.exe -NoLogo -NoProfile -NoExit -Command "New-PSDrive -Name Luuna -PSProvider FileSystem -Root 'C:\data\root' | Out-Null; Set-Location Luuna:\\""#
        );
    }
}
