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
assert.ok(Array.isArray(entries) && entries.length >= 12, 'Expected valid and invalid fixtures for all six new contracts');
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
assert.equal(coverage.size, 6, 'All six new schemas must be exercised');
for (const [schema, outcomes] of coverage) assert.equal(outcomes.size, 2, `Missing positive or negative fixture for ${schema}`);
console.log(`Contracts: ${checks} positive/negative checks passed across ${compiled.size + starterPairs.length} schemas.`);
