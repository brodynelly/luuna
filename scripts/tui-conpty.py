# Windows ConPTY driver for the native terminal audit. Standard-library only.
# JSONL control uses stdin/stdout; credentials stay in the inherited environment.
import base64, ctypes as C, json, os, pathlib, subprocess, sys, threading, time
from ctypes import wintypes as W

k = C.WinDLL('kernel32', use_last_error=True)
HANDLE=W.HANDLE; SIZE=C.c_size_t
class COORD(C.Structure): _fields_=[('X',C.c_short),('Y',C.c_short)]
class SI(C.Structure):
    _fields_=[('cb',W.DWORD),('lpReserved',W.LPWSTR),('lpDesktop',W.LPWSTR),('lpTitle',W.LPWSTR),('dwX',W.DWORD),('dwY',W.DWORD),('dwXSize',W.DWORD),('dwYSize',W.DWORD),('dwXCountChars',W.DWORD),('dwYCountChars',W.DWORD),('dwFillAttribute',W.DWORD),('dwFlags',W.DWORD),('wShowWindow',W.WORD),('cbReserved2',W.WORD),('lpReserved2',C.POINTER(C.c_byte)),('hStdInput',HANDLE),('hStdOutput',HANDLE),('hStdError',HANDLE)]
class SIX(C.Structure): _fields_=[('StartupInfo',SI),('lpAttributeList',C.c_void_p)]
class PI(C.Structure): _fields_=[('hProcess',HANDLE),('hThread',HANDLE),('dwProcessId',W.DWORD),('dwThreadId',W.DWORD)]
def bind(n,args,result=W.BOOL):
    f=getattr(k,n);f.argtypes=args;f.restype=result;return f
CreatePipe=bind('CreatePipe',[C.POINTER(HANDLE),C.POINTER(HANDLE),C.c_void_p,W.DWORD])
CreatePseudoConsole=bind('CreatePseudoConsole',[COORD,HANDLE,HANDLE,W.DWORD,C.POINTER(HANDLE)],C.c_long)
ResizePseudoConsole=bind('ResizePseudoConsole',[HANDLE,COORD],C.c_long)
ClosePseudoConsole=bind('ClosePseudoConsole',[HANDLE],None)
InitializeProcThreadAttributeList=bind('InitializeProcThreadAttributeList',[C.c_void_p,W.DWORD,W.DWORD,C.POINTER(SIZE)])
UpdateProcThreadAttribute=bind('UpdateProcThreadAttribute',[C.c_void_p,W.DWORD,SIZE,C.c_void_p,SIZE,C.c_void_p,C.c_void_p])
DeleteProcThreadAttributeList=bind('DeleteProcThreadAttributeList',[C.c_void_p],None)
CreateProcess=bind('CreateProcessW',[W.LPCWSTR,W.LPWSTR,C.c_void_p,C.c_void_p,W.BOOL,W.DWORD,C.c_void_p,W.LPCWSTR,C.POINTER(SIX),C.POINTER(PI)])
CloseHandle=bind('CloseHandle',[HANDLE])
PeekNamedPipe=bind('PeekNamedPipe',[HANDLE,C.c_void_p,W.DWORD,C.c_void_p,C.POINTER(W.DWORD),C.c_void_p])
ReadFile=bind('ReadFile',[HANDLE,C.c_void_p,W.DWORD,C.POINTER(W.DWORD),C.c_void_p])
WriteFile=bind('WriteFile',[HANDLE,C.c_void_p,W.DWORD,C.POINTER(W.DWORD),C.c_void_p])
WaitForSingleObject=bind('WaitForSingleObject',[HANDLE,W.DWORD],W.DWORD)
GetExitCodeProcess=bind('GetExitCodeProcess',[HANDLE,C.POINTER(W.DWORD)])
TerminateProcess=bind('TerminateProcess',[HANDLE,W.UINT])
def ok(v):
    if not v: raise C.WinError(C.get_last_error())

class Console:
    def __init__(self, request):
        self.hin,self.win,self.rout,self.hout,self.hpc=HANDLE(),HANDLE(),HANDLE(),HANDLE(),HANDLE()
        self.pi=PI();self.attributes=None;self.buffer=bytearray();self.lock=threading.Lock();self.stop=threading.Event();self.reader=None
        self.closed=False;self.truncated=False
        try:
            ok(CreatePipe(C.byref(self.hin),C.byref(self.win),None,0))
            ok(CreatePipe(C.byref(self.rout),C.byref(self.hout),None,0))
            assert CreatePseudoConsole(COORD(request['columns'],request['rows']),self.hin,self.hout,0,C.byref(self.hpc))==0
            self.reader=threading.Thread(target=self.drain,daemon=True);self.reader.start()
            size=SIZE();InitializeProcThreadAttributeList(None,1,0,C.byref(size))
            self.attributes=C.create_string_buffer(size.value)
            ok(InitializeProcThreadAttributeList(self.attributes,1,0,C.byref(size)))
            ok(UpdateProcThreadAttribute(self.attributes,0,0x00020016,self.hpc,C.sizeof(HANDLE),None,None))
            si=SIX();si.StartupInfo.cb=C.sizeof(si);si.StartupInfo.dwFlags=0x100
            si.lpAttributeList=C.cast(self.attributes,C.c_void_p)
            argv=request['argv']
            # A console-attached supervisor measures console modes around the real
            # public entry; it neither mocks the client nor takes its terminal input.
            if request.get('result'):
                os.environ['LUUNA_AUDIT_ARGV']=json.dumps(argv)
                os.environ['LUUNA_AUDIT_RESULT']=request['result']
                argv=[sys.executable,str(pathlib.Path(__file__).resolve()),'--supervise']
            command=C.create_unicode_buffer(subprocess.list2cmdline(argv))
            ok(CreateProcess(None,command,None,None,False,0x00080000,None,request.get('cwd'),C.byref(si),C.byref(self.pi)))
            CloseHandle(self.hin);self.hin=HANDLE();CloseHandle(self.hout);self.hout=HANDLE()
        except BaseException:
            self.close();raise

    def drain(self):
        while not self.stop.is_set():
            available=W.DWORD()
            if not PeekNamedPipe(self.rout,None,0,None,C.byref(available),None):return
            if not available.value:self.stop.wait(.01);continue
            buffer=C.create_string_buffer(min(available.value,65536));got=W.DWORD()
            if not ReadFile(self.rout,buffer,len(buffer),C.byref(got),None):return
            with self.lock:
                self.buffer.extend(buffer.raw[:got.value])
                if len(self.buffer)>8*1024*1024:self.truncated=True;del self.buffer[:-8*1024*1024]

    def send(self, data):
        if len(data)>4096:raise ValueError('Input exceeds 4096 bytes; chunk writes')
        finished=threading.Event();errors=[]
        def write():
            try:
                written=W.DWORD();ok(WriteFile(self.win,data,len(data),C.byref(written),None))
                if written.value!=len(data):raise OSError('Partial ConPTY write')
            except Exception as error:errors.append(error)
            finally:finished.set()
        threading.Thread(target=write,daemon=True).start()
        if not finished.wait(3):raise TimeoutError('ConPTY input timed out')
        if errors:raise errors[0]

    def poll(self):
        with self.lock:data=bytes(self.buffer);self.buffer.clear()
        code=W.DWORD();ok(GetExitCodeProcess(self.pi.hProcess,C.byref(code)))
        return {'data':base64.b64encode(data).decode('ascii'),'exit':None if code.value==259 else code.value,'pid':self.pi.dwProcessId,'truncated':self.truncated}

    def resize(self, columns, rows):
        if not (1<=columns<=500 and 1<=rows<=200):raise ValueError('Invalid terminal dimensions')
        if ResizePseudoConsole(self.hpc,COORD(columns,rows))!=0:raise OSError('ConPTY resize failed')

    def close(self):
        if self.closed:return
        self.closed=True
        if self.pi.hProcess and WaitForSingleObject(self.pi.hProcess,0)!=0:
            TerminateProcess(self.pi.hProcess,99);WaitForSingleObject(self.pi.hProcess,5000)
        failure=None
        if self.hpc:
            closer=threading.Thread(target=lambda:ClosePseudoConsole(self.hpc),daemon=True)
            closer.start();closer.join(5)
            if closer.is_alive():failure=TimeoutError('ConPTY close timed out')
        self.stop.set()
        if self.reader:self.reader.join(2)
        if self.attributes:DeleteProcThreadAttributeList(self.attributes)
        for handle in [self.hin,self.win,self.rout,self.hout,self.pi.hThread,self.pi.hProcess]:
            if handle:CloseHandle(handle)
        if failure:raise failure

def supervise():
    get_handle=bind('GetStdHandle',[W.DWORD],HANDLE)
    get_mode=bind('GetConsoleMode',[HANDLE,C.POINTER(W.DWORD)])
    def modes():
        result=[]
        for number in [-10,-11]:
            mode=W.DWORD();ok(get_mode(get_handle(number & 0xffffffff),C.byref(mode)));result.append(mode.value)
        return result
    report={'before':modes()}
    child=subprocess.Popen(json.loads(os.environ.pop('LUUNA_AUDIT_ARGV')))
    report['child_pid']=child.pid
    result=pathlib.Path(os.environ.pop('LUUNA_AUDIT_RESULT'))
    result.write_text(json.dumps(report))
    report['exit']=child.wait()
    try:report['after']=modes()
    except Exception as error:report['mode_error']=str(error)
    result.write_text(json.dumps(report))
    # The supervisor does not write terminal output. Python's shutdown flush can
    # race ConPTY detach and replace the child's status with 120 (flush failure).
    # The result file is already closed; preserve the observed child exit exactly.
    os._exit(report['exit'])

def serve():
    console=None
    try:
        for line in sys.stdin:
            request={}
            try:
                request=json.loads(line)
                operation=request['op']
                if operation=='open':
                    if console:raise ValueError('A console is already open')
                    console=Console(request);result={'pid':console.pi.dwProcessId}
                elif operation=='send':console.send(base64.b64decode(request['data']));result={}
                elif operation=='poll':result=console.poll()
                elif operation=='resize':console.resize(request['columns'],request['rows']);result={}
                elif operation=='close':console.close();result={}
                else:raise ValueError('Unknown terminal operation')
                print(json.dumps({'id':request.get('id'),'result':result}),flush=True)
            except Exception as error:
                # No argv or environment in diagnostics.
                print(json.dumps({'id':request.get('id'),'error':type(error).__name__+': '+str(error)}),flush=True)
    finally:
        if console:console.close()

if __name__=='__main__':
    if '--supervise' in sys.argv:supervise()
    else:serve()

