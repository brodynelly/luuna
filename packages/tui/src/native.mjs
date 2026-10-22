// Interactive-only launcher. The Rust process owns the terminal and its JSONL bridge.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { constants } from "node:os";
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

export async function launchNative({ env, stdin, stdout, stderr, root, platform = process.platform, spawnProcess = spawn, signals = process }) {
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
    const handlers = new Map();
    const finish = (code) => {
      for (const [signal, handler] of handlers) signals.off(signal, handler);
      resolve(code);
    };
    try {
      child = spawnProcess(paths.binary, ["--bridge", paths.bridge, "--node", process.execPath], {
        env: { ...env }, stdio: [stdin, stdout, stderr], windowsHide: true,
      });
    } catch {
      stderr.write("The Rust terminal application could not start. Rebuild it with the pinned Rust toolchain or reinstall this platform's distribution.\n");
      finish(1);
      return;
    }
    // Ctrl-C in raw mode is input handled by Rust. A console control event reaches
    // both processes on Windows; child.kill('SIGINT') would force-terminate it.
    for (const signal of ["SIGINT", "SIGTERM"]) {
      const handler = () => { if (platform !== "win32" || signal !== "SIGINT") child.kill(signal); };
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
