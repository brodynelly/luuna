import { readdirSync, readFileSync } from "node:fs";
import { expect, test } from "vitest";

// Parity evidence (R02, A33): every action in the shared capability catalog is reachable from a
// desktop control, marked with its catalog id in a `data-capability` attribute. A control that
// triggers several reads carries several ids separated by spaces.
interface Capability { id: string; desktop: string; client_method: string }
const root = new URL("./", import.meta.url);
const catalog = JSON.parse(readFileSync(new URL("../../../schemas/capability-catalog.json", root), "utf8")) as { capabilities: Capability[] };
const sources = readdirSync(root, { recursive: true })
  .map((file) => file.replaceAll("\\", "/"))
  .filter((file) => /\.tsx?$/.test(file) && !file.includes(".test.") && !file.endsWith(".d.ts"))
  .map((file) => [file, readFileSync(new URL(file, root), "latin1")] as const);
// A panel's code lives in its folder (ADR 0030); its legacy file name is a barrel.
const AREAS: Record<string, string> = { "Projects.tsx": "projects/", "Workflows.tsx": "workflows/", "ProjectComponents.tsx": "project-components/", "CandidateReview.tsx": "candidate/" };
function area(name: string): string {
  return sources.filter(([file]) => file === name || file.startsWith(AREAS[name] ?? `${name}/`)).map(([, text]) => text).join("\n");
}
const exposed = new Map<string, string[]>();
for (const [file, source] of sources) {
  for (const match of source.matchAll(/data-capability="([^"]+)"/g)) {
    for (const id of match[1].split(/\s+/).filter(Boolean)) exposed.set(id, [...(exposed.get(id) ?? []), file]);
  }
}

test("every cataloged action is exposed by a desktop control carrying its id", () => {
  const missing = catalog.capabilities.filter((capability) => !exposed.has(capability.desktop)).map((capability) => capability.id);
  expect(missing).toEqual([]);
});

test("every data-capability value on the desktop is a cataloged action", () => {
  const ids = new Set(catalog.capabilities.map((capability) => capability.desktop));
  const unknown = [...exposed].filter(([id]) => !ids.has(id)).map(([id, files]) => `${id} in ${files.join(", ")}`);
  expect(unknown).toEqual([]);
});

test("the desktop calls each cataloged client method it exposes directly, or the catalog says how it reaches the action", () => {
  const indirect = new Set(["plan", "followEvents"]);
  const code = sources.map(([, source]) => source).join("\n");
  for (const capability of catalog.capabilities) {
    if (indirect.has(capability.client_method)) continue;
    expect(code, `${capability.id} should call client.${capability.client_method}`).toMatch(new RegExp(`\\.${capability.client_method}\\(`));
  }
});

// ---- Behaviour level (audit findings 2 and 7): a marker proves wiring; these prove the desktop
// builds the cataloged request and shows state-specific controls. The request bodies themselves
// are covered beside each panel (Projects.test.tsx, Workflows.test.tsx, ProjectComponents.test.tsx)
// through the builders packages/api-client shares with the TUI. ----
test("state-specific controls share one capability: Implement for an approved run and Resume task for a resumable task both carry runs.implement", () => {
  const workflows = area("Workflows.tsx");
  expect(workflows.match(/data-capability="runs.implement"/g)?.length).toBeGreaterThanOrEqual(2);
  expect(workflows).toMatch(/run\.state === "approved"[^\n]*data-capability="runs.implement"/);
  expect(workflows).toMatch(/taskResumable\(run, task\)[^\n]*data-capability="runs.implement"/);
  expect(workflows).toMatch(/task_id: taskId/);
});

test("every repository, task and memory control sends the cataloged body through the shared builders", () => {
  const projects = area("Projects.tsx");
  expect(projects).toMatch(/registerProject\(registrationRequest\(name, projectId, rows\)/);
  expect(projects).toMatch(/startBaseline\(selected, \{ repository_id: repositoryId \}/);
  const workflows = area("Workflows.tsx");
  expect(workflows).toMatch(/planRequestFromRows\(rows, \{ \.\.\.budgets, max_workers: workers \}/);
  expect(workflows).toMatch(/updateTicket\(ticket\.id, request/);
  const components = area("ProjectComponents.tsx");
  expect(components).toMatch(/updateMemory\(projectId, record\.id, \{ idempotency_key: .*expected_hash: record\.hash, content \}/);
  expect(components).toMatch(/setMemoryRetention\(projectId, retentionPolicyFromForm\(processDays, projectDays\)/);
  expect(components).toMatch(/applyMemoryRetention\(projectId, \{ idempotency_key:/);
  expect(components).toMatch(/exportUserMemory\(signal\)/);
});

test("the catalog traces every action to what requires it, and the required actions of ADR 0026 are wired in the desktop", () => {
  const required = JSON.parse(readFileSync(new URL("../../../schemas/capability-catalog.json", root), "utf8")) as { capabilities: (Capability & { required_by: string[] })[] };
  for (const capability of required.capabilities) expect(capability.required_by.length, capability.id).toBeGreaterThan(0);
  for (const id of ["tickets.update", "memory.update", "memory.user.export", "memory.retention.set", "memory.retention.apply", "baselines.start", "projects.register", "plans.create", "runs.implement", "runs.cancel", "runs.publication.reconcile", "runs.stream"]) expect(exposed.has(id), id).toBe(true);
});

// ---- ADR 0022 and ADR 0023: state-specific variants and the fields the desktop sends; ADR 0027 point 4: the experience surfaces. ----
test("the testing-setup offer's create control is a variant of ticket creation, and the setup plan, roles and overrides go through the shared builder", () => {
  const workflows = area("Workflows.tsx");
  expect(workflows.match(/data-capability="tickets.create"/g)?.length).toBeGreaterThanOrEqual(2);
  expect(workflows).toMatch(/prefillSetupTicket\(offer\)\}>Create the testing-setup ticket for/);
  expect(workflows).toMatch(/\.\.\.\(purpose !== "feature" && \{ purpose \}\)/);
  expect(workflows).toMatch(/planRequestFromRows\(rows, \{ \.\.\.budgets, max_workers: workers \}, [^\n]*overrideRows, setup \? checks : \[\]\)/);
  expect(workflows).toMatch(/failure instanceof ApiError && failure\.prerequisite\) setRefusedOffer/);
  expect(workflows).toMatch(/overrideFromRefusal\(failure\.message\)/);
  expect(workflows).toMatch(/aria-label=\{`Task \$\{index \+ 1\} role`\}/);
  expect(workflows).toContain("Derive plan from this proposal");
});

test("the experience surfaces of ADR 0027 point 4 exist as marked desktop panels projecting cataloged actions", () => {
  const surfaces = new Map<string, string[]>();
  for (const [file, source] of sources) for (const match of source.matchAll(/data-surface="([^"]+)"/g)) surfaces.set(match[1], [...(surfaces.get(match[1]) ?? []), file]);
  expect([...surfaces.keys()].sort()).toEqual(["board", "editor-handoff", "help", "home", "settings"]);
  expect(surfaces.get("home")).toEqual(["Home.tsx"]);
  expect(surfaces.get("board")).toEqual(["Board.tsx"]);
  expect(surfaces.get("help")).toEqual(["Help.tsx"]);
  expect(surfaces.get("editor-handoff")).toEqual(["candidate/Handoffs.tsx"]);
  expect(surfaces.get("settings")).toEqual(["Settings.tsx"]);
  // Settings are the runtime's doctor report (ADR 0027 point 4): one cataloged read, nothing editable.
  const settings = area("Settings.tsx");
  expect(settings).toContain('data-capability="doctor"');
  expect(settings).not.toMatch(/<(input|textarea|form)\b/);
  const board = area("Board.tsx");
  expect(board).not.toMatch(/draggable|onDragStart|onDrop/);
  expect(board).toContain("boardProjection(");
  expect(area("Home.tsx")).toContain("homeSummary(");
});
