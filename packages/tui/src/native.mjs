// Interactive-only launcher. The Rust process owns the terminal and its JSONL bridge.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { constants, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../../../", import.meta.url));

export function nativePaths({ root = defaultRoot, env = process.env, platform = process.platform } = {}) {
  root = path.resolve(root);
  const development = existsSync(path.join(root, "Cargo.toml"));
  // Cargo's standard explicit target override is useful in isolated worktrees. It is
  // never consulted by an installed distribution, even when inherited from a shell.
  const target = path.resolve(root, env.CARGO_TARGET_DIR || "target");
  return {
    root, development,
    binary: path.join(development ? path.join(target, "debug") : root, platform === "win32" ? "luuna-tui.exe" : "luuna-tui"),
    bridge: path.join(root, "packages", "tui", "src", "bridge.mjs"),
  };
}

export async function launchNative({ env, stdin, stdout, stderr, root, platform = process.platform, spawnProcess = spawn, signals = process, shutdownMs = 3000 }) {
  const paths = nativePaths({ root, env, platform });
  if (!existsSync(paths.binary)) {
    stderr.write(paths.development
      ? "The Rust terminal application is not built. Run `cargo build --locked -p luuna-tui` at the Luuna checkout root, then run `npm run tui` again.\n"
      : "The installed Rust terminal application is missing. Reinstall the complete Luuna distribution (luuna-tui.exe and its packages directory).\n");
    return 1;
  }
  if (!existsSync(paths.bridge)) {
    stderr.write("The Luuna terminal bridge is missing. Restore packages/tui/src/bridge.mjs or reinstall the complete distribution.\n");
    return 1;
  }
  return new Promise((resolve) => {
    let child;
    let controlDirectory;
    let timer;
    let forcedTimer;
    let finished = false;
    let stopping = false;
    const previousRaw = Boolean(stdin?.isRaw);
    const handlers = new Map();
    const finish = (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(forcedTimer);
      for (const [signal, handler] of handlers) signals.off(signal, handler);
      if (controlDirectory) {
        try { unlinkSync(path.join(controlDirectory, "shutdown")); } catch { /* absent or already removed */ }
        try { rmdirSync(controlDirectory); } catch { /* never recursively remove an unexpected entry */ }
      }
      resolve(code);
    };
    try {
      // Empty control marker only: no credentials, socket service, or terminal input
      // reader. Windows kill(SIGTERM) cannot request graceful process shutdown.
      controlDirectory = mkdtempSync(path.join(tmpdir(), "luuna-tui-control-"));
      child = spawnProcess(paths.binary, ["--bridge", paths.bridge, "--node", process.execPath], {
        env: { ...env, LUUNA_TUI_SHUTDOWN_FILE: path.join(controlDirectory, "shutdown") }, stdio: [stdin, stdout, stderr], windowsHide: true,
      });
    } catch {
      stderr.write("The Rust terminal application could not start. Rebuild it with the pinned Rust toolchain or reinstall this platform's distribution.\n");
      finish(1);
      return;
    }
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", ...(platform === "win32" ? ["SIGBREAK"] : [])]) {
      const handler = () => {
        if (stopping || finished) return;
        stopping = true;
        try { writeFileSync(path.join(controlDirectory, "shutdown"), "", { mode: 0o600 }); }
        catch { stderr.write("The native shutdown request could not be delivered; waiting for bounded cleanup.\n"); }
        timer = setTimeout(() => {
          stderr.write("The Rust terminal did not finish graceful shutdown; stopping the owned process.\n");
          try { child.kill("SIGKILL"); } catch { /* owned process may already have exited */ }
          // Best-effort restoration for a hung native process; normal shutdown is
          // restored by Rust with its recorded original terminal state.
          if (stdin?.isTTY && typeof stdin.setRawMode === "function") { try { stdin.setRawMode(previousRaw); } catch { /* lost terminal */ } }
          if (stdout?.isTTY) { try { stdout.write("\x1b[?2004l\x1b[?25h\x1b[?1049l"); } catch { /* lost terminal */ } }
          forcedTimer = setTimeout(() => finish(1), 1000);
        }, shutdownMs);
      };
      handlers.set(signal, handler);
      signals.on(signal, handler);
    }
    child.once("error", () => {
      stderr.write("The Rust terminal application could not start. Check its platform and executable permissions, then rebuild or reinstall it.\n");
      finish(1);
    });
    child.once("close", (code, signal) => finish(Number.isInteger(code) ? code : 128 + (constants.signals[signal] ?? 1)));
  });
}
