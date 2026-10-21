import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
console.log(`Contracts: ${checks} positive/negative checks passed across ${compiled.size + starterPairs.length} schemas.`);
