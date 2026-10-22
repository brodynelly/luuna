import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const starterPairs = [['project', 'project'], ['result', 'check-result'], ['event', 'event']];
let checks = 0;
for (const [schema, fixture] of starterPairs) {
  const definition = read(`schemas/${schema}.schema.json`);
  const validate = ajv.compile(definition);
  const example = read(`examples/${fixture}.json`);
  assert.equal(validate(example), true, `${fixture}: ${ajv.errorsText(validate.errors)}`);
  const invalid = structuredClone(example);
  delete invalid[definition.required[0]];
  assert.equal(validate(invalid), false, `${schema} accepted missing required field`);
  checks += 2;
}
const manifest = read('fixtures/domain/manifest.json');
const entries = Array.isArray(manifest) ? manifest : manifest.fixtures;
assert.ok(Array.isArray(entries) && entries.length >= 14, 'Expected valid and invalid fixtures for all seven contracts');
const compiled = new Map();
const coverage = new Map();
for (const item of entries) {
  let validate = compiled.get(item.schema);
  if (!validate) {
    validate = ajv.compile(read(item.schema));
    compiled.set(item.schema, validate);
  }
  const actual = validate(read(item.fixture));
  assert.equal(actual, item.valid, `${item.fixture}: expected valid=${item.valid}; ${ajv.errorsText(validate.errors)}`);
  if (!coverage.has(item.schema)) coverage.set(item.schema, new Set());
  coverage.get(item.schema).add(item.valid);
  checks += 1;
}
assert.equal(coverage.size, 7, 'All seven schemas must be exercised');
for (const [schema, outcomes] of coverage) assert.equal(outcomes.size, 2, `Missing positive or negative fixture for ${schema}`);
// Optional component snapshots preserve legacy fixtures and require reviewable bytes.
const planValidator = compiled.get('schemas/plan-revision.schema.json');
const componentPlan = read('fixtures/domain/plan.valid.json');
componentPlan.component_context = {
  memory: [{ id: 'mem-fixture', scope: 'project', hash: `sha256:${'1'.repeat(64)}`, content: 'Synthetic selected content', provenance: 'Explicit contract fixture' }],
  prompt: { name: 'guidance', version: 1, hash: `sha256:${'2'.repeat(64)}`, body: 'Synthetic selected guidance' },
};
assert.equal(planValidator(componentPlan), true, ajv.errorsText(planValidator.errors));
const missingContent = structuredClone(componentPlan);
delete missingContent.component_context.memory[0].content;
assert.equal(planValidator(missingContent), false, 'Component memory must expose exact approved bytes');
const missingBody = structuredClone(componentPlan);
delete missingBody.component_context.prompt.body;
assert.equal(planValidator(missingBody), false, 'Component prompt must expose its approved body');
const invalidScope = structuredClone(componentPlan);
invalidScope.component_context.memory[0].scope = 'automatic';
assert.equal(planValidator(invalidScope), false, 'Unknown memory scope was accepted');
checks += 4;
// A review must be self-consistent: a non-passing verdict names a finding and
// stored text carries no terminal control sequences.
const reviewValidator = compiled.get('schemas/review-result.schema.json');
const review = read('fixtures/domain/review.valid.json');
for (const verdict of ['changes_required', 'blocked']) {
  assert.equal(reviewValidator({ ...review, verdict, findings: [] }), false, `${verdict} without findings was accepted`);
}
const finding = { severity: 'warning', path: 'src/main.rs', line: 1, explanation: 'Seeded issue', evidence: ['observed'] };
assert.equal(reviewValidator({ ...review, verdict: 'changes_required', findings: [finding] }), true, ajv.errorsText(reviewValidator.errors));
assert.equal(reviewValidator({ ...review, verdict: 'changes_required', findings: [{ ...finding, explanation: 'red \u001b[31m alert' }] }), false, 'Terminal escapes were accepted in a finding');
assert.equal(reviewValidator({ ...review, evidence: [' \n\t'] }), false, 'Whitespace-only review evidence was accepted');
checks += 5;
console.log(`Contracts: ${checks} positive/negative checks passed across ${compiled.size + starterPairs.length} schemas.`);
// ---- Client capability catalog (R02, A33): one entry per product action, validated against
// the runtime's served routes, the typed client and the shared failure classes. ----
const catalogSchema = read('schemas/capability-catalog.schema.json');
const validateCatalog = ajv.compile(catalogSchema);
const catalog = read('schemas/capability-catalog.json');
assert.equal(validateCatalog(catalog), true, `capability catalog: ${ajv.errorsText(validateCatalog.errors)}`);
const capabilities = catalog.capabilities;
for (const field of ['id', 'tui', 'desktop']) {
  const values = capabilities.map((capability) => capability[field]);
  assert.equal(new Set(values).size, values.length, `capability ${field} values must be unique`);
}
const endpoints = capabilities.map((capability) => `${capability.method} ${capability.route}`);
assert.equal(new Set(endpoints).size, endpoints.length, 'each method and route pair is cataloged once');
// The routes the runtime serves, read from its router source (read-only): `.route("<path>", <handlers>)`.
const runtimeSource = readFileSync(resolve(root, 'crates/luuna-runtime/src/lib.rs'), 'utf8');
const served = new Map();
for (const match of runtimeSource.matchAll(/\.route\(\s*"([^"]+)"\s*,([\s\S]*?)\)\s*(?=\n\s*\.(?:route|route_layer|layer|merge)\b|\n\s*;|;)/g)) {
  const methods = served.get(match[1]) ?? new Set();
  for (const handler of match[2].matchAll(/\b(get|post|put|delete)\(/g)) methods.add(handler[1].toUpperCase());
  served.set(match[1], methods);
}
assert.ok(served.size >= 30, `expected the runtime router to declare its routes; found ${served.size}`);
for (const capability of capabilities) {
  const methods = served.get(capability.route);
  assert.ok(methods, `${capability.id}: the runtime serves no route ${capability.route}`);
  assert.ok(methods.has(capability.method), `${capability.id}: the runtime serves ${capability.route} with ${[...methods].join('/')}, not ${capability.method}`);
}
checks += capabilities.length;
// Every cataloged client method exists on the typed client, and every failure mode is a shared class.
const client = await import('../packages/api-client/src/index.ts');
for (const capability of capabilities) {
  assert.equal(typeof client.LuunaClient.prototype[capability.client_method], 'function', `${capability.id}: LuunaClient has no method ${capability.client_method}`);
  for (const mode of capability.failure_modes) assert.ok(client.FAILURE_CLASSES.includes(mode), `${capability.id}: unknown failure class ${mode}`);
}
checks += capabilities.length;
// Runtime mutations that no client exposes yet are named, so a new runtime action cannot stay
// invisible: each one still needs a catalog entry, a desktop control and a TUI command (R02).
// Every served mutation is cataloged since ADR 0020's parity closed; a new one fails here unless
// LUUNA_CATALOG_STRICT=0 is set while it is being wired.
const uncataloged = [...served].flatMap(([route, methods]) => [...methods].filter((method) => method !== 'GET' && route.startsWith('/api/v1/') && !endpoints.includes(`${method} ${route}`)).map((method) => `${method} ${route}`));
if (process.env.LUUNA_CATALOG_STRICT !== '0') assert.deepEqual(uncataloged, [], `runtime mutations missing from schemas/capability-catalog.json: ${uncataloged.join(', ')}`);
checks += 1;
console.log(`Capability catalog: ${capabilities.length} actions validated against ${served.size} runtime routes and the typed client.${uncataloged.length ? ` Runtime mutations without client parity yet (${uncataloged.length}): ${uncataloged.join(', ')}.` : ''}`);
// ---- Required actions (R02, R14, A33; docs/06-memory.md, docs/09-experience.md, ADR 0017/0018/0026):
// each product action the specification requires maps to at least one catalog entry whose desktop
// control (a data-capability marker in apps/desktop/src) and TUI command (packages/tui/src/commands.mjs)
// both exist, and every entry says what requires it. A catalog that merely lists routes cannot
// establish these obligations; this check fails when either client loses the control. ----
const REQUIRED_ACTIONS = {
  'ticket edit (docs/09-experience.md#browser-and-tui-parity, docs/06-memory.md#personal-memory)': ['tickets.update'],
  'memory inspect (docs/06-memory.md#personal-memory)': ['memory.list'],
  'memory edit (docs/06-memory.md#personal-memory)': ['memory.update'],
  'memory export, personal (docs/06-memory.md#personal-memory)': ['memory.user.export'],
  'memory delete (docs/06-memory.md#boundaries)': ['memory.delete'],
  'memory disable: private memory excluded unless explicitly included, retention by policy (docs/06-memory.md#boundaries)': ['memory.list', 'memory.retention.set', 'memory.retention.apply'],
  'memory promotion (docs/06-memory.md#project-knowledge-and-process-lessons)': ['memory.promote'],
  'multi-repository registration (R05, docs/09-experience.md#existing-project)': ['projects.register'],
  'multi-repository planning with dependencies and workers (R05, A12, ADR 0017)': ['plans.create'],
  'per-repository baselines (R08, ADR 0017)': ['baselines.start', 'baselines.list'],
  'task resume by task_id (A20, ADR 0017)': ['runs.implement', 'runs.tasks'],
  'publication reconcile (R11, R12, ADR 0018)': ['runs.publication.reconcile'],
  'cancel (docs/09-experience.md#views)': ['runs.cancel'],
  'recovery and reconnect (R15, A20, docs/09-experience.md#lifecycle-and-portability)': ['health', 'runs.stream', 'runs.events'],
  'testing-setup prerequisite: the offer, a testing_setup ticket, a setup plan with recipes and the handoff (R08, A06, ADR 0022)': ['baselines.list', 'projects.show', 'tickets.create', 'plans.create', 'runs.candidate'],
  'delegated roles, assignment traces, dependency overrides and advisory results (R06, P42, P44, ADR 0023)': ['plans.create', 'runs.tasks', 'runs.candidate'],
};
// ---- Experience surfaces (docs/09-experience.md#views, ADR 0027 point 4): projections of the
// cataloged read actions, not actions of their own. Each is traced to the catalog entries it
// projects (both clients wired), to a desktop panel carrying `data-surface="<name>"` and to a TUI
// projection command (`PROJECTIONS` in packages/tui/src/commands.mjs) reading only those entries. ----
const REQUIRED_SURFACES = {
  'home summary: projects, validation health, blockers, create ticket (docs/09-experience.md#views, ADR 0027 point 4)': { projects: ['projects.list', 'projects.show', 'baselines.list', 'tickets.list', 'runs.list', 'tickets.create'], desktop: 'home', tui: 'home' },
  'kanban projection of authoritative run state (docs/09-experience.md#views, ADR 0027 point 4)': { projects: ['projects.list', 'projects.show', 'tickets.list', 'runs.list'], desktop: 'board', tui: 'board' },
  'help: onboarding, states, evidence, documentation (docs/09-experience.md#views, ADR 0027 point 4)': { projects: ['health'], desktop: 'help', tui: null },
  'external-editor handoff: the candidate worktree path with a copy control (docs/09-experience.md#views, ADR 0027 point 4)': { projects: ['runs.worktrees', 'runs.candidate'], desktop: 'editor-handoff', tui: null },
  'settings: the runtime environment and credential presence as shown by doctor, never values, not an editor (docs/09-experience.md#views, ADR 0027 point 4)': { projects: ['doctor'], desktop: 'settings', tui: 'doctor' },
};
const byId = new Map(capabilities.map((capability) => [capability.id, capability]));
const desktopSources = readdirSync(resolve(root, 'apps/desktop/src'), { recursive: true })
  .map((file) => String(file).replaceAll('\\', '/'))
  .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
  .map((file) => readFileSync(resolve(root, 'apps/desktop/src', file), 'utf8'))
  .join('\n');
const desktopMarkers = new Set([...desktopSources.matchAll(/data-capability="([^"]+)"/g)].flatMap((match) => match[1].split(/\s+/).filter(Boolean)));
const { commandsById } = await import('../packages/tui/src/commands.mjs');
for (const [action, ids] of Object.entries(REQUIRED_ACTIONS)) {
  const wired = ids.filter((id) => {
    const capability = byId.get(id);
    return capability && desktopMarkers.has(capability.desktop) && commandsById.has(id);
  });
  assert.ok(wired.length > 0, `required action "${action}" maps to no catalog entry with both clients wired (candidates: ${ids.join(', ')})`);
  for (const id of ids) {
    const capability = byId.get(id);
    assert.ok(capability, `required action "${action}": catalog has no entry ${id}`);
    assert.ok(desktopMarkers.has(capability.desktop), `required action "${action}": no desktop control carries data-capability="${capability.desktop}"`);
    assert.ok(commandsById.has(id), `required action "${action}": no TUI command implements ${id}`);
  }
}
for (const capability of capabilities) assert.ok(capability.required_by.length > 0, `${capability.id}: required_by names what requires this action`);
checks += Object.keys(REQUIRED_ACTIONS).length;
console.log(`Required actions: ${Object.keys(REQUIRED_ACTIONS).length} specification obligations traced to cataloged actions with desktop and TUI controls.`);
const desktopSurfaces = new Set([...desktopSources.matchAll(/data-surface="([^"]+)"/g)].map((match) => match[1]));
const { commandsByName, projectionsByName } = await import('../packages/tui/src/commands.mjs');
for (const [surface, trace] of Object.entries(REQUIRED_SURFACES)) {
  for (const id of trace.projects) {
    const capability = byId.get(id);
    assert.ok(capability, `required surface "${surface}": catalog has no entry ${id}`);
    assert.ok(desktopMarkers.has(capability.desktop) && commandsById.has(id), `required surface "${surface}": projected action ${id} is not wired in both clients`);
  }
  assert.ok(desktopSurfaces.has(trace.desktop), `required surface "${surface}": no desktop panel carries data-surface="${trace.desktop}"`);
  if (trace.tui) {
    // A projection command (`PROJECTIONS`) reads the entries it names; a surface that is one
    // cataloged read (settings: `doctor`) is the action's own command.
    const command = projectionsByName.get(trace.tui) ?? commandsByName.get(trace.tui);
    assert.ok(command, `required surface "${surface}": no TUI command ${trace.tui}`);
    const reads = command.projects ?? [command.id];
    assert.ok(reads.every((id) => trace.projects.includes(id)), `required surface "${surface}": TUI ${trace.tui} reads ${reads.join(', ')}, outside the traced actions`);
    assert.ok(reads.every((id) => byId.get(id)?.method === 'GET'), `required surface "${surface}": TUI ${trace.tui} must read only`);
  }
}
checks += Object.keys(REQUIRED_SURFACES).length;
console.log(`Required surfaces: ${Object.keys(REQUIRED_SURFACES).length} experience surfaces traced to the cataloged actions they project, a desktop panel and (where one exists) a TUI projection.`);
