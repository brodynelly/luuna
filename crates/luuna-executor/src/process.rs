//! Process-tree ownership is established before a Windows child can execute.
//!
//! Unix children lead a dedicated process group. Windows children are created
//! suspended, assigned to a kill-on-close job object and only then resumed, so
//! nothing the child starts can escape the job; a child that cannot be owned
//! is killed and the spawn fails.
use std::io;
use tokio::process::{Child, Command};

pub(super) struct Owner {
    #[cfg(windows)]
    job: Option<super::job::Job>,
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

    #[cfg(not(any(unix, windows)))]
    fn new(_child: &Child) -> io::Result<Self> {
        Ok(Self {})
    }

    #[cfg(windows)]
    fn new(child: &Child) -> io::Result<Self> {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, INVALID_HANDLE_VALUE},
            System::{Diagnostics::ToolHelp::*, Threading::*},
        };
        let handle = child
            .raw_handle()
            .ok_or_else(|| io::Error::other("child handle unavailable"))?;
        let job = super::job::Job::contain(handle)
            .ok_or_else(|| io::Error::other("could not assign the child to a job object"))?;
        let owner = Self { job: Some(job) };
        // SAFETY: the snapshot and thread handles are newly owned and closed
        // here; THREADENTRY32 carries its exact size. The child is suspended.
        unsafe {
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
        }
        Ok(owner)
    }

    /// The kill-on-close job holding the tree, until `stop` closes it.
    #[cfg(windows)]
    pub(super) fn job(&self) -> Option<&super::job::Job> {
        self.job.as_ref()
    }

    pub(super) fn stop(&mut self) {
        #[cfg(windows)]
        {
            // Closing our only handle terminates exactly this job's tree.
            self.job = None;
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
