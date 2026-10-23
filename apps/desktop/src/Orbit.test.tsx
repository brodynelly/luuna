import { readFileSync } from "node:fs";
import { describe, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { OrbitExecution, OrbitView, SandboxPlan } from "@luuna/api-client";
import { orbitTone } from "@luuna/ui";
import { Orbit } from "./Orbit";
import { OrbitForms } from "./orbit/OrbitForms";
import { dirtyText, executionSummary, execRequest, orbitActions, tailPath, upstreamText } from "./orbit/orbit-model";
import { OrbitResults } from "./orbit/OrbitResults";
import { SandboxPanel } from "./orbit/OrbitSandbox";
import { OrbitStatusTable } from "./orbit/OrbitStatus";

const clean = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, paths: [], truncated: false };
const view: OrbitView = {
  project_id: "luuna", name: "Luuna", observed_at: "2026-10-22T10:00:00Z", manifest_revision: 3, recipes: ["test", "lint"],
  repositories: [
    { repository_id: "app", local_path: "/src/luuna", present: true, branch: "main", head_commit: "0123456789abcdef", upstream: { name: "origin/main", ahead: 2, behind: 1 }, dirty: { ...clean, unstaged: 2, untracked: 1 }, remote: "https://example.test/luuna.git", recipes: ["test", "lint"], error: null },
    { repository_id: "atlas", local_path: "/src/luuna-atlas", present: false, branch: null, head_commit: null, upstream: null, dirty: null, remote: null, recipes: ["test"], error: "checkout not found at /src/luuna-atlas" },
    { repository_id: "beacon", local_path: "/src/luuna-beacon", present: true, branch: "feature", head_commit: "fedcba9876543210", upstream: null, dirty: clean, remote: null, recipes: [], error: null },
  ],
};
const all = view.repositories.map((repository) => repository.repository_id);
const execution: OrbitExecution = {
  id: "orb-1", project_id: "luuna", kind: "exec", command: ["git", "status"], started_at: "2026-10-22T10:01:00Z", finished_at: "2026-10-22T10:01:02Z",
  results: [
    { repository_id: "app", status: "succeeded", exit_code: 0, reason: null, command: ["git", "status"], stdout_excerpt: "On branch main", stderr_excerpt: "", started_at: "", finished_at: "" },
    { repository_id: "atlas", status: "blocked", exit_code: null, reason: "checkout is missing", command: [], stdout_excerpt: "", stderr_excerpt: "", started_at: "", finished_at: "" },
    { repository_id: "beacon", status: "failed", exit_code: 1, reason: "exited with 1", command: ["git", "status"], stdout_excerpt: "", stderr_excerpt: "fatal: bad", started_at: "", finished_at: "" },
  ],
};
const plan: SandboxPlan = {
  version: 1, project_id: "luuna", backend: "app_container", available: true, reason: null, workdir: "C:\\sbx\\root", host_root: null, home: "C:\\data\\sandboxes\\luuna\\home",
  repositories: [{ repository_id: "app", host_path: "C:\\src\\luuna", sandbox_path: "C:\\sbx\\root\\luuna" }], network: "none", container_name: "luuna.sbx.luuna", notes: ["The first grant can take minutes."],
};

function mockClient() {
  return {
    orbit: vi.fn(async () => view),
    orbitExec: vi.fn(async () => execution),
    orbitRun: vi.fn(async () => execution),
    orbitSync: vi.fn(async () => execution),
    orbitSandbox: vi.fn(async () => plan),
  };
}

describe("Orbit requests", () => {
  test("exec splits the typed command with quotes and sends every repository by default", async () => {
    const client = mockClient();
    await orbitActions.exec(client, "luuna", { line: 'git commit -m "two words"', selected: all, all, parallel: false, timeout: "" });
    expect(client.orbitExec).toHaveBeenCalledWith("luuna", { executable: "git", args: ["commit", "-m", "two words"], parallel: false }, undefined);
  });

  test("exec sends the chosen repositories, parallel and the timeout; refuses an empty command, no repository or a bad timeout", async () => {
    const client = mockClient();
    await orbitActions.exec(client, "luuna", { line: "npm test", selected: ["beacon", "app"], all, parallel: true, timeout: "120" });
    expect(client.orbitExec).toHaveBeenCalledWith("luuna", { executable: "npm", args: ["test"], parallel: true, repositories: ["app", "beacon"], timeout_seconds: 120 }, undefined);
    expect(() => execRequest({ line: "  ", selected: all, all, parallel: false, timeout: "" })).toThrow("Type a command");
    expect(() => execRequest({ line: "ls", selected: [], all, parallel: false, timeout: "" })).toThrow("Select at least one repository.");
    expect(() => execRequest({ line: "ls", selected: all, all, parallel: false, timeout: "3601" })).toThrow("1 to 3600 seconds");
    expect(() => execRequest({ line: "ls", selected: all, all, parallel: false, timeout: "1.5" })).toThrow("1 to 3600 seconds");
  });

  test("run sends the recipe and the selection", async () => {
    const client = mockClient();
    await orbitActions.run(client, "luuna", "test", all, all, false);
    expect(client.orbitRun).toHaveBeenCalledWith("luuna", { recipe: "test", parallel: false }, undefined);
    await orbitActions.run(client, "luuna", "lint", ["app"], all, true);
    expect(client.orbitRun).toHaveBeenLastCalledWith("luuna", { recipe: "lint", parallel: true, repositories: ["app"] }, undefined);
  });

  test("sync sends the fetch toggle", async () => {
    const client = mockClient();
    await orbitActions.sync(client, "luuna", true, all, all);
    expect(client.orbitSync).toHaveBeenCalledWith("luuna", { fetch: true }, undefined);
    await orbitActions.sync(client, "luuna", false, ["atlas"], all);
    expect(client.orbitSync).toHaveBeenLastCalledWith("luuna", { fetch: false, repositories: ["atlas"] }, undefined);
  });

  test("the sandbox plan is read with the chosen network", async () => {
    const client = mockClient();
    const signal = new AbortController().signal;
    expect(await orbitActions.sandbox(client, "luuna", "none", signal)).toBe(plan);
    expect(client.orbitSandbox).toHaveBeenCalledWith("luuna", "none", signal);
    await orbitActions.sandbox(client, "luuna", "open");
    expect(client.orbitSandbox).toHaveBeenLastCalledWith("luuna", "open", undefined);
  });
});

describe("Orbit rendering", () => {
  test("the status table shows branch, upstream, changes, recipes and a missing checkout with its error", () => {
    const html = renderToStaticMarkup(<OrbitStatusTable view={view} />);
    expect(upstreamText(view.repositories[0])).toBe("↑2 ↓1");
    expect(upstreamText(view.repositories[2])).toBe("no upstream");
    expect(dirtyText(view.repositories[0].dirty)).toBe("3 uncommitted changes");
    expect(dirtyText(clean)).toBe("clean");
    expect(tailPath(String.raw`C:\Users\dev\AppData\github\app`)).toBe(String.raw`…\AppData\github\app`);
    expect(tailPath("/home/dev/github/app")).toBe("…/dev/github/app");
    expect(tailPath("/srv/app")).toBe("/srv/app");
    expect(html).toContain('aria-label="Repositories of Luuna"');
    expect(html).toContain("↑2 ↓1");
    expect(html).toContain("no upstream");
    expect(html).toContain("3 uncommitted changes");
    expect(html).toContain('<span class="state" data-tone="attention">missing checkout</span>');
    expect(html).toContain("checkout not found at /src/luuna-atlas");
    expect(html).toContain('<span class="state">present</span>');
    expect(html).toContain('<span class="tag">lint</span>');
  });

  test("succeeded is never the success tone; failed and blocked are danger; the results say they are not evidence", () => {
    expect(orbitTone.succeeded).not.toBe("success");
    expect(Object.values(orbitTone)).not.toContain("success");
    const html = renderToStaticMarkup(<OrbitResults execution={execution} />);
    expect(html).not.toContain('data-tone="success"');
    expect(html).toContain('<span class="state" data-tone="neutral">succeeded</span>');
    expect(html).toContain('<span class="state" data-tone="danger">failed</span>');
    expect(html).toContain('<span class="state" data-tone="danger">blocked</span>');
    expect(html).toContain("Not evidence: these are your commands, not checks.");
    expect(html).toContain('aria-label="stdout of app"');
    expect(html).toContain('aria-label="stderr of beacon"');
    expect(executionSummary(execution)).toBe("Command finished in 3 repositories: 1 succeeded, 1 blocked, 1 failed.");
  });

  test("the sandbox panel shows the plan and a copy control carrying the lu sbx command", () => {
    const html = renderToStaticMarkup(<SandboxPanel projectId="luuna" network="none" plan={plan} busy={false} onNetwork={() => undefined} onCopy={() => undefined} />);
    expect(html).toContain('data-copy="lu sbx luuna --network none"');
    expect(html).toContain("<code class=\"orbit-command-text\">lu sbx luuna --network none</code>");
    expect(html).toContain('<legend>Sandbox network</legend>');
    expect(html).toMatch(/name="orbit-sandbox-network" checked="" value="none"/);
    expect(html).toContain("cannot host the interactive terminal");
    for (const text of ["app_container", "C:\\sbx\\root", "C:\\data\\sandboxes\\luuna\\home", "C:\\src\\luuna", "(read-write)", "The first grant can take minutes."]) expect(html).toContain(text);
    expect(html).not.toContain('data-tone="success"');
    const open = renderToStaticMarkup(<SandboxPanel projectId="luuna" network="open" plan={null} busy={false} onNetwork={() => undefined} onCopy={() => undefined} />);
    expect(open).toContain('data-copy="lu sbx luuna"');
  });

  test("the forms carry their catalog markers and the sync fetch toggle starts on", () => {
    const html = renderToStaticMarkup(<OrbitForms view={view} disabled={false} actions={{ exec: () => undefined, run: () => undefined, sync: () => undefined }} />);
    for (const id of ["orbit.exec", "orbit.run", "orbit.sync"]) expect(html).toContain(`data-capability="${id}"`);
    expect(html).toMatch(/<input type="checkbox" id="[^"]+" name="fetch-present-checkouts" checked=""\/> Fetch present checkouts/);
    expect(html).toContain('<option value="test" selected="">test</option><option value="lint">lint</option>');
    const page = renderToStaticMarkup(<Orbit client={null} />);
    expect(page).toContain('aria-labelledby="orbit-heading"');
    expect(page).toContain("Connect to the runtime");
    const source = readFileSync(new URL("./Orbit.tsx", import.meta.url), "utf8");
    expect(source).toContain('data-capability="orbit.status"');
    expect(source).toContain('data-capability="orbit.sandbox"');
  });
});
