import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const helper = fileURLToPath(new URL("./windows-m3-job.py", import.meta.url));
const windows = process.platform === "win32";
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => /^(path|systemroot|windir|pathext|userprofile|temp|tmp|comspec)$/i.test(name)));

test("job owns detached grandchildren, contains breakaway requests and leaves unrelated processes alone", { skip: !windows }, async () => {
  const canary = spawn("python", ["-I", "-c", "import time; time.sleep(60)"], { env: environment, windowsHide: true, stdio: "ignore" });
  const canaryExit = once(canary, "exit");
  const dir = mkdtempSync(path.join(tmpdir(), "luuna-job-test-"));
  try {
    const code = `
      const {spawnSync} = require('node:child_process');
      const {readFileSync} = require('node:fs');
      const python = process.env.LUUNA_M3_JOB_PYTHON;
      const marker = ${JSON.stringify(path.join(dir, "pid"))};
      const tree = spawnSync(python, ['-I', '-c', 'import subprocess, sys; p=subprocess.Popen([sys.executable,"-I","-c","import time; time.sleep(60)"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=8); open(sys.argv[1],"w").write(str(p.pid))', marker], {encoding:'utf8', windowsHide:true});
      if(tree.status !== 0) throw Error(tree.stderr);
      const membership = 'import runpy,os,sys; m=runpy.run_path(sys.argv[1]); j=m["OpenJob"](4,False,os.environ["LUUNA_M3_JOB"]); h=m["OpenProcess"](0x1000,False,os.getpid()); print(int(m["belongs"](h,j))); m["Close"](h); m["Close"](j)';
      const escape = spawnSync(python, ['-I','-c','import subprocess,sys; p=subprocess.run([sys.executable,"-I","-c",sys.argv[1],sys.argv[2]],creationflags=0x01000000); sys.exit(p.returncode)',membership,${JSON.stringify(helper)}], {encoding:'utf8',windowsHide:true});
      if(escape.status === 0 && escape.stdout.trim() !== '1') throw Error('child escaped the owned job');
      const reap = spawnSync(python, ['-I',${JSON.stringify(helper)},'reap',process.env.LUUNA_M3_JOB,String(process.pid)], {encoding:'utf8',windowsHide:true});
      console.log(JSON.stringify({pid:Number(readFileSync(marker,'utf8')),reap:JSON.parse(reap.stdout)}));
      process.exit(reap.status);
    `;
    const result = spawnSync("python", ["-I", helper, "run", process.execPath, "-e", code], { env: environment, encoding: "utf8", windowsHide: true, timeout: 25_000 });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.reap.contained, true);
    assert(report.reap.killed >= 1, "at least the detached grandchild must be stopped; Windows may also create owned console helpers");
    assert.equal(alive(report.pid), false);
    assert.equal(alive(canary.pid), true);
  } finally {
    canary.kill(); await canaryExit;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("supervisor death closes the job and stops its live harness", { skip: !windows }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "luuna-job-death-"));
  const marker = path.join(dir, "pid");
  const child = spawn("python", ["-I", helper, "run", process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000)`], { env: environment, windowsHide: true, stdio: "ignore" });
  const exited = once(child, "exit");
  try {
    for (let i=0; i<100 && !existsSync(marker); i++) await sleep(50);
    const pid = Number(readFileSync(marker, "utf8"));
    assert(alive(pid));
    child.kill(); await exited;
    for(let i=0;i<100 && alive(pid);i++) await sleep(50);
    assert.equal(alive(pid), false);
  } finally { if(child.exitCode === null && child.signalCode === null) {child.kill(); await exited;} rmSync(dir,{recursive:true,force:true}); }
});

test("missing ownership fails closed", { skip: !windows }, () => {
  const result = spawnSync("python", ["-I", helper, "reap", "Local\\LuunaM3-does-not-exist", String(process.pid)], { env: environment, encoding: "utf8", windowsHide: true });
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).contained, false);
});
