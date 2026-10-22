import { setTimeout as sleep } from "node:timers/promises";

// Process exit and pipe closure are different: a surviving child can retain stderr.
// Final artifact scans always require both; restart first observes process exit,
// then reconciles the reviewer, then requires the old log pipe to drain.
export function settled(child) {
  return (child.exitCode !== null || child.signalCode !== null) && child.stdioClosed !== false;
}

export async function waitForExit(child, timeoutMs, { drain = true } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const exited = child.exitCode !== null || child.signalCode !== null;
    if (exited && (!drain || settled(child))) return { exited: true, elapsed: Date.now() - startedAt };
    await sleep(50);
  }
  return { exited: false, elapsed: Date.now() - startedAt };
}
