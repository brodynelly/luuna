"""Windows M3 harness ownership, not a sandbox. Requires Python 3 on Windows.

The supervisor owns a kill-on-close Job Object. The harness starts suspended,
is assigned before its first instruction, and cannot request breakaway. The
reaper checks job membership on opened process handles before terminating them.
"""
import ctypes as c
from ctypes import wintypes as w
import json
import os
import subprocess
import sys
import time
import uuid

if sys.platform != 'win32':
    raise SystemExit('Windows Job Object supervision requires Windows')
k = c.WinDLL('kernel32', use_last_error=True)
SIZE_T = c.c_size_t
ULONG_PTR = c.c_size_t

class BasicLimits(c.Structure):
    _fields_ = [('process_time', c.c_int64), ('job_time', c.c_int64),
                ('flags', w.DWORD), ('min_working', SIZE_T), ('max_working', SIZE_T),
                ('active_limit', w.DWORD), ('affinity', ULONG_PTR),
                ('priority', w.DWORD), ('scheduling', w.DWORD)]

class IoCounters(c.Structure):
    _fields_ = [(name, c.c_uint64) for name in ('read_ops', 'write_ops', 'other_ops', 'read_bytes', 'write_bytes', 'other_bytes')]

class ExtendedLimits(c.Structure):
    _fields_ = [('basic', BasicLimits), ('io', IoCounters), ('process_memory', SIZE_T),
                ('job_memory', SIZE_T), ('peak_process', SIZE_T), ('peak_job', SIZE_T)]

class ThreadEntry(c.Structure):
    _fields_ = [('size', w.DWORD), ('usage', w.DWORD), ('tid', w.DWORD),
                ('pid', w.DWORD), ('base', w.LONG), ('delta', w.LONG), ('flags', w.DWORD)]

def api(name, args, result):
    fn = getattr(k, name)
    fn.argtypes, fn.restype = args, result
    return fn

CreateJob = api('CreateJobObjectW', [c.c_void_p, w.LPCWSTR], w.HANDLE)
OpenJob = api('OpenJobObjectW', [w.DWORD, w.BOOL, w.LPCWSTR], w.HANDLE)
SetJob = api('SetInformationJobObject', [w.HANDLE, c.c_int, c.c_void_p, w.DWORD], w.BOOL)
QueryJob = api('QueryInformationJobObject', [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p], w.BOOL)
Assign = api('AssignProcessToJobObject', [w.HANDLE, w.HANDLE], w.BOOL)
InJob = api('IsProcessInJob', [w.HANDLE, w.HANDLE, c.POINTER(w.BOOL)], w.BOOL)
OpenProcess = api('OpenProcess', [w.DWORD, w.BOOL, w.DWORD], w.HANDLE)
Terminate = api('TerminateProcess', [w.HANDLE, w.UINT], w.BOOL)
Wait = api('WaitForSingleObject', [w.HANDLE, w.DWORD], w.DWORD)
Close = api('CloseHandle', [w.HANDLE], w.BOOL)
Snapshot = api('CreateToolhelp32Snapshot', [w.DWORD, w.DWORD], w.HANDLE)
ThreadFirst = api('Thread32First', [w.HANDLE, c.POINTER(ThreadEntry)], w.BOOL)
ThreadNext = api('Thread32Next', [w.HANDLE, c.POINTER(ThreadEntry)], w.BOOL)
OpenThread = api('OpenThread', [w.DWORD, w.BOOL, w.DWORD], w.HANDLE)
Resume = api('ResumeThread', [w.HANDLE], w.DWORD)

def require(value):
    if not value:
        raise c.WinError(c.get_last_error())
    return value

def resume(pid):
    snap = Snapshot(4, 0)  # TH32CS_SNAPTHREAD
    if snap == w.HANDLE(-1).value:
        raise c.WinError(c.get_last_error())
    try:
        entry = ThreadEntry(size=c.sizeof(ThreadEntry))
        found = ThreadFirst(snap, c.byref(entry))
        while found:
            if entry.pid == pid:
                thread = require(OpenThread(2, False, entry.tid))
                try:
                    if Resume(thread) == 0xffffffff:
                        raise c.WinError(c.get_last_error())
                    return
                finally:
                    Close(thread)
            found = ThreadNext(snap, c.byref(entry))
        raise RuntimeError('suspended primary thread was not found')
    finally:
        Close(snap)

def supervise(argv):
    name = 'Local\\LuunaM3-' + str(uuid.uuid4())
    job = require(CreateJob(None, name))
    child = None
    try:
        limits = ExtendedLimits()
        limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE, no BREAKAWAY_OK
        require(SetJob(job, 9, c.byref(limits), c.sizeof(limits)))
        env = dict(os.environ, LUUNA_M3_JOB=name, LUUNA_M3_JOB_PARENT=str(os.getpid()), LUUNA_M3_JOB_PYTHON=sys.executable)
        child = subprocess.Popen(argv, env=env, creationflags=4, close_fds=True)
        require(Assign(job, int(child._handle)))
        resume(child.pid)
        return child.wait()
    finally:
        # Also kills detached descendants if the harness crashes before cleanup.
        Close(job)
        if child is not None and child.poll() is None:
            child.kill()
            child.wait()

def members(job):
    capacity = 64
    while capacity <= 65536:
        class Pids(c.Structure):
            _fields_ = [('assigned', w.DWORD), ('count', w.DWORD), ('ids', ULONG_PTR * capacity)]
        value = Pids()
        if QueryJob(job, 3, c.byref(value), c.sizeof(value), None):
            return list(value.ids[:value.count])
        if c.get_last_error() != 234:  # ERROR_MORE_DATA
            raise c.WinError(c.get_last_error())
        capacity *= 2
    raise RuntimeError('job process count exceeds the inspection bound')

def belongs(handle, job):
    contained = w.BOOL()
    require(InJob(handle, job, c.byref(contained)))
    return bool(contained.value)

def reap(name, harness_pid):
    job = require(OpenJob(4, False, name))  # query only
    killed = set()
    try:
        harness = require(OpenProcess(0x1000, False, harness_pid))
        try:
            if not belongs(harness, job):
                raise RuntimeError('harness is not a member of the owned job')
        finally:
            Close(harness)
        own = require(OpenProcess(0x1000, False, os.getpid()))
        try:
            if not belongs(own, job):
                raise RuntimeError('reaper is not a member of the owned job')
        finally:
            Close(own)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            pending = set(members(job)) - {harness_pid, os.getpid()}
            if not pending:
                return {'contained': True, 'killed': len(killed), 'mechanism': 'Windows Job Object'}
            for pid in pending:
                handle = OpenProcess(0x1000 | 0x100000 | 1, False, pid)
                if not handle:
                    # Exit can race enumeration. Still-live inaccessible members
                    # remain in the job count and fail the deadline below.
                    continue
                try:
                    if belongs(handle, job):
                        if Wait(handle, 0) == 0:
                            continue
                        if not Terminate(handle, 1):
                            if Wait(handle, 0) == 0:
                                continue
                            raise c.WinError(c.get_last_error())
                        killed.add(pid)
                        remaining = max(0, int((deadline - time.monotonic()) * 1000))
                        Wait(handle, min(remaining, 1000))
                finally:
                    Close(handle)
            time.sleep(.02)
        return {'contained': False, 'killed': len(killed), 'reason': 'owned job did not drain within 15 seconds'}
    finally:
        Close(job)

if __name__ == '__main__':
    if sys.argv[1] == 'run':
        raise SystemExit(supervise(sys.argv[2:]))
    if sys.argv[1] == 'reap':
        try:
            result = reap(sys.argv[2], int(sys.argv[3]))
        except Exception as error:
            result = {'contained': False, 'killed': 0, 'reason': str(error)}
        print(json.dumps(result))
        raise SystemExit(0 if result['contained'] else 1)
    raise SystemExit('unknown supervision command')
