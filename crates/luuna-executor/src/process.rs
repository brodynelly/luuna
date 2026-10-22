//! Process-tree ownership is established before a Windows child can execute.
use std::io;
use tokio::process::{Child, Command};

pub(super) struct Owner {
    #[cfg(windows)]
    job: windows_sys::Win32::Foundation::HANDLE,
    #[cfg(unix)]
    pid: Option<u32>,
}

pub(super) async fn spawn(command: &mut Command) -> io::Result<(Child, Owner)> {
    #[cfg(windows)]
    command.creation_flags(0x08000004); // CREATE_NO_WINDOW | CREATE_SUSPENDED
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn()?;
    match Owner::new(&child) {
        Ok(owner) => Ok((child, owner)),
        Err(error) => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(error)
        }
    }
}

impl Owner {
    #[cfg(unix)]
    fn new(child: &Child) -> io::Result<Self> {
        Ok(Self { pid: child.id() })
    }

    #[cfg(windows)]
    fn new(child: &Child) -> io::Result<Self> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
            System::{Diagnostics::ToolHelp::*, JobObjects::*, Threading::*},
        };
        // SAFETY: all handles below are newly owned; configuration is initialized
        // and Windows receives the exact structure size. The child is suspended.
        unsafe {
            let job = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if job.is_null() {
                return Err(io::Error::last_os_error());
            }
            let owner = Self { job };
            let mut limits = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
                || AssignProcessToJobObject(
                    job,
                    child
                        .raw_handle()
                        .ok_or_else(|| io::Error::other("child handle unavailable"))?
                        as _,
                ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            let mut entry = THREADENTRY32 {
                dwSize: std::mem::size_of::<THREADENTRY32>() as u32,
                ..Default::default()
            };
            let mut found = Thread32First(snapshot, &mut entry);
            let mut resumed = false;
            while found != 0 {
                if Some(entry.th32OwnerProcessID) == child.id() {
                    let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
                    if !thread.is_null() {
                        resumed = ResumeThread(thread) != u32::MAX;
                        CloseHandle(thread);
                    }
                    break;
                }
                found = Thread32Next(snapshot, &mut entry);
            }
            CloseHandle(snapshot);
            if !resumed {
                return Err(io::Error::other("could not resume owned child"));
            }
            Ok(owner)
        }
    }

    pub(super) fn stop(&mut self) {
        #[cfg(windows)]
        if !self.job.is_null() {
            // SAFETY: closing our final handle terminates only this job's tree.
            unsafe {
                windows_sys::Win32::Foundation::CloseHandle(self.job);
            }
            self.job = std::ptr::null_mut();
        }
        #[cfg(unix)]
        if let Some(pid) = self.pid.take() {
            // SAFETY: this is the dedicated process group created at spawn.
            unsafe {
                libc::killpg(pid as libc::pid_t, libc::SIGKILL);
            }
        }
    }
}

impl Drop for Owner {
    fn drop(&mut self) {
        self.stop();
    }
}
// The owned handle can be moved between executor tasks, never shared or copied.
#[cfg(windows)]
unsafe impl Send for Owner {}
