import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadParameters, requireParameter } from '../lib/parameters.js';

const parametersFiles = [
  { label: 'organs/human-organs/stomach/motility.parameters.json', url: new URL('../organs/human-organs/stomach/motility.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/duodenum/nutrient-exposure.parameters.json', url: new URL('../organs/human-organs/duodenum/nutrient-exposure.parameters.json', import.meta.url) },
  { label: 'organs/human-organs/stomach/ghrelin.parameters.json', url: new URL('../organs/human-organs/stomach/ghrelin.parameters.json', import.meta.url) },
  { label: 'systems/sensory/gastric-sensory.parameters.json', url: new URL('../systems/sensory/gastric-sensory.parameters.json', import.meta.url) },
  { label: 'systems/nervous/interoception.parameters.json', url: new URL('../systems/nervous/interoception.parameters.json', import.meta.url) },
];

const sourcedStatuses = new Set(['prior', 'fitted_dev', 'validated']);

function readParameters(url) {
  return JSON.parse(readFileSync(url, 'utf8'));
}

for (const { label, url } of parametersFiles) {
  test(`${label}: schema, ids, unset/null and sources are consistent`, () => {
    const data = readParameters(url);
    assert.equal(data.schemaVersion, 1, 'schemaVersion must be 1');
    assert.equal(typeof data.owner, 'string', 'owner must be a string');
    assert.ok(data.owner.length > 0, 'owner must not be empty');

    const ids = data.parameters.map((parameter) => parameter.id);
    assert.equal(new Set(ids).size, ids.length, 'parameter ids must be unique');

    for (const parameter of data.parameters) {
      assert.ok(parameter.id.startsWith(`${data.owner}.`), `${parameter.id} must start with ${data.owner}.`);
      assert.equal(parameter.status === 'unset', parameter.value === null, `${parameter.id}: unset status and null value must match`);
      if (sourcedStatuses.has(parameter.status)) {
        assert.ok(typeof parameter.source === 'string' && parameter.source.length > 0, `${parameter.id} needs a source`);
      }
    }

    const values = loadParameters(url);
    assert.deepEqual(Object.keys(values).sort(), [...ids].sort());
    for (const parameter of data.parameters) {
      assert.equal(values[parameter.id], parameter.value, `${parameter.id}: loader value`);
    }
  });
}

test('parameter ids are unique across all parameter files', () => {
  const ids = parametersFiles.flatMap(({ url }) => readParameters(url).parameters.map((parameter) => parameter.id));
  assert.equal(new Set(ids).size, ids.length, 'parameter ids must be unique across files');
});

test('requireParameter rejects missing and unset ids with the id in the message', () => {
  const values = loadParameters(parametersFiles.at(-1).url);
  const unsetId = 'interoception.discomfort.threshold';
  assert.equal(values[unsetId], null);

  assert.throws(() => requireParameter(values, 'interoception.missing'), (error) => error.message.includes('interoception.missing'));
  assert.throws(() => requireParameter(values, unsetId), (error) => error.message.includes(unsetId));
});
