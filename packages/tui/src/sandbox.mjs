// `lu sbx` (ADR 0036): hands the runtime's sandbox plan to the native `luuna-sbx` launcher with
// the terminal attached. The plan travels in the launcher's environment, never on its command
// line; the runtime token and URL never reach the sandboxed process.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Variables a sandboxed process must never inherit: the runtime's credentials. */
export const WITHHELD = ["LUUNA_API_TOKEN", "LUUNA_URL"];

/**
 * Where `luuna-sbx` lives: `target/debug` (honoring CARGO_TARGET_DIR) in a source checkout, beside
 * the runtime in an installed layout; there is no PATH search, as for the native terminal (ADR 0029).
 */
export function sandboxBinary({ root = defaultRoot, env = process.env, platform = process.platform } = {}) {
  root = path.resolve(root);
  const development = existsSync(path.join(root, "Cargo.toml"));
  const target = path.resolve(root, env.CARGO_TARGET_DIR || "target");
  return { development, binary: path.join(development ? path.join(target, "debug") : root, platform === "win32" ? "luuna-sbx.exe" : "luuna-sbx") };
}

/** The launcher's environment: the caller's minus the runtime credentials, plus the plan. */
export function sandboxEnvironment(env, plan) {
  const out = { ...env };
  for (const name of Object.keys(out)) if (WITHHELD.includes(name.toUpperCase())) delete out[name];
  out.LUUNA_SBX_PLAN = JSON.stringify(plan);
  return out;
}

/** Starts `luuna-sbx run` with the terminal attached; resolves with the sandboxed command's exit code. */
export function launchSandbox(plan, command, { grants = [], env = process.env, stdio = "inherit", root, platform = process.platform, spawnProcess = spawn } = {}) {
  const { binary, development } = sandboxBinary({ root, env, platform });
  if (!existsSync(binary)) {
    return Promise.reject(new Error(development
      ? "The sandbox launcher is not built. Run `cargo build --locked -p luuna-sandbox` at the Luuna checkout root, then run `lu sbx` again."
      : "The installed sandbox launcher (luuna-sbx) is missing. Reinstall the complete Luuna distribution."));
  }
  const args = ["run", ...grants.flatMap((dir) => ["--grant-read", dir]), ...(command.length ? ["--", ...command] : [])];
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess(binary, args, { env: sandboxEnvironment(env, plan), stdio });
    } catch (failure) {
      reject(failure);
      return;
    }
    // The sandboxed command owns Ctrl+C while it runs; the client only waits for it.
    const ignore = () => {};
    process.on("SIGINT", ignore);
    const done = (code) => { process.off("SIGINT", ignore); resolve(code ?? 1); };
    child.once("error", (failure) => { process.off("SIGINT", ignore); reject(failure); });
    child.once("exit", (code, signal) => done(signal ? 128 + (signal === "SIGINT" ? 2 : 15) : code));
  });
}
