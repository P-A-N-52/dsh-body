import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const systemsRoot = join(repoRoot, 'systems');
const scenariosRoot = join(repoRoot, 'scenarios');
const sourceIndexPath = join(repoRoot, 'systems', 'digestive', 'references', 'source-index.csv');

const allowedSystems = new Set([
  'musculoskeletal', 'digestive', 'respiratory', 'circulatory', 'urinary',
  'reproductive', 'nervous', 'endocrine', 'immune', 'sensory', 'integumentary',
]);
const allowedKinds = new Set(['organ', 'hormone', 'sensory', 'neural', 'tissue', 'compartment']);
const allowedSignalKinds = new Set(['state', 'flux', 'readout']);
const allowedStatuses = new Set(['unset', 'design', 'prior', 'fitted_dev', 'validated', 'rejected']);
const allowedTypes = new Set(['number', 'string', 'boolean', 'object', 'null', 'array']);
const allowedImplementations = new Set(['planned', 'in_progress', 'ready']);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function where(file) {
  return relative(repoRoot, file).split(sep).join('/');
}

function assertString(value, label) {
  assert.equal(typeof value, 'string', `${label} must be a string`);
  assert.ok(value.length > 0, `${label} must not be empty`);
}

function assertNumber(value, label) {
  assert.equal(typeof value, 'number', `${label} must be a number`);
  assert.ok(Number.isFinite(value), `${label} must be finite`);
}

function assertRange(range, label) {
  assert.ok(Array.isArray(range) && range.length === 2, `${label} must be [min, max|null]`);
  assertNumber(range[0], `${label}[0]`);
  if (range[1] !== null) {
    assertNumber(range[1], `${label}[1]`);
    assert.ok(range[0] <= range[1], `${label} min must not exceed max`);
  }
}

function assertSource(source, label, sourceIds) {
  if (source === null) return;
  assertString(source, label);
  if (source.startsWith('pending:')) {
    assert.match(source, /^pending:[a-z0-9-]+$/, `${label} must be pending:<citekey>`);
    return;
  }
  assert.ok(sourceIds.has(source), `${label} references unknown source ${source}`);
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const sourceIds = new Set(
  readFileSync(sourceIndexPath, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => line.split(',')[0].replace(/^"|"$/g, '')),
);

const components = new Map();
const signals = new Map();
const actions = new Map();
const parameterIds = new Map();
const readoutIds = new Map();
const componentFiles = walk(systemsRoot).filter((file) => file.endsWith('.component.json'));

test('model contracts separate public signals from private state', () => {
  assert.ok(componentFiles.length >= 4, 'expected at least four component contracts');

  for (const file of componentFiles) {
    const data = readJson(file);
    const label = where(file);

    assert.equal(data.schemaVersion, 1, `${label}: schemaVersion must be 1`);
    assertString(data.id, `${label}: id`);
    assert.match(data.id, /^[a-z][a-zA-Z0-9]*$/, `${label}: id must be camelCase`);
    assert.ok(!components.has(data.id), `${label}: duplicate component id ${data.id}`);
    assert.ok(allowedSystems.has(data.system), `${label}: unknown system ${data.system}`);
    assert.ok(allowedKinds.has(data.kind), `${label}: unknown kind ${data.kind}`);
    assert.ok(allowedImplementations.has(data.implementation), `${label}: unknown implementation ${data.implementation}`);
    assertString(data.module, `${label}: module`);
    assert.match(data.module, /^\.\/.+\.ts$/, `${label}: module must be a relative .ts path`);
    if (data.implementation === 'ready') {
      assert.ok(existsSync(resolve(dirname(file), data.module)), `${label}: module file is missing`);
    }
    assertNumber(data.version, `${label}: version`);

    if (data.model !== undefined) {
      assert.ok(isPlainObject(data.model), `${label}: model must be an object`);
      for (const [name, value] of Object.entries(data.model)) {
        assertString(name, `${label}: model name`);
        assertString(value, `${label}: model.${name}`);
      }
    }

    assert.ok(isPlainObject(data.signals) && Object.keys(data.signals).length > 0, `${label}: signals must be a non-empty object`);
    for (const [id, signal] of Object.entries(data.signals)) {
      assert.ok(id.startsWith(`${data.id}.`), `${label}: signal ${id} must start with ${data.id}.`);
      const field = id.slice(data.id.length + 1);
      assert.ok(field && !field.includes('.'), `${label}: signal ${id} must map to a top-level state field`);
      assert.ok(!signals.has(id), `${label}: duplicate signal ${id}`);
      assertString(signal.unit, `${label}: ${id}.unit`);
      assertRange(signal.range, `${label}: ${id}.range`);
      assert.ok(allowedSignalKinds.has(signal.kind), `${label}: ${id}.kind`);
      assert.equal(signal.commit, 'roundEnd', `${label}: ${id}.commit must be roundEnd`);
      if (signal.nullable !== undefined) assert.equal(typeof signal.nullable, 'boolean', `${label}: ${id}.nullable`);
      if (signal.derivedFrom !== undefined) {
        assert.ok(Array.isArray(signal.derivedFrom), `${label}: ${id}.derivedFrom must be an array`);
        for (const source of signal.derivedFrom) assertString(source, `${label}: ${id}.derivedFrom`);
      }
      signals.set(id, { owner: data.id, spec: signal, file });
    }

    assert.ok(Array.isArray(data.writes), `${label}: writes must be an array`);
    assert.deepEqual([...data.writes].sort(), Object.keys(data.signals).sort(), `${label}: writes must match signals`);
    assert.ok(Array.isArray(data.reads), `${label}: reads must be an array`);
    for (const id of data.reads) assertString(id, `${label}: reads`);
    assert.equal(new Set(data.reads).size, data.reads.length, `${label}: reads must be unique`);

    assert.ok(isPlainObject(data.state), `${label}: state must be an object`);
    for (const [field, spec] of Object.entries(data.state)) {
      assertString(field, `${label}: state field`);
      assert.ok(['public', 'private'].includes(spec.visibility), `${label}: ${field}.visibility must be public or private`);
      if (`${data.id}.${field}` in data.signals) {
        assert.equal(spec.visibility, 'public', `${label}: ${field} is a signal and must be public`);
      } else {
        assert.equal(spec.visibility, 'private', `${label}: ${field} is not a signal and must be private`);
      }
      const types = Array.isArray(spec.type) ? spec.type : [spec.type];
      assert.ok(types.length > 0 && types.every((type) => allowedTypes.has(type)), `${label}: ${field}.type`);
      if (spec.unit === null) {
        assert.ok(!types.includes('number'), `${label}: ${field}.unit can be null only for non-numeric state`);
      } else {
        assertString(spec.unit, `${label}: ${field}.unit`);
      }
      if (spec.min !== undefined) assertNumber(spec.min, `${label}: ${field}.min`);
      if (spec.max !== undefined) assertNumber(spec.max, `${label}: ${field}.max`);
      if (spec.min !== undefined && spec.max !== undefined) assert.ok(spec.min <= spec.max, `${label}: ${field} min/max`);
      assert.ok('initial' in spec, `${label}: ${field}.initial is required`);
      if (spec.initial === null) {
        assert.ok(types.includes('null'), `${label}: ${field}.initial null is not allowed`);
      } else if (typeof spec.initial === 'number') {
        assert.ok(types.includes('number') && Number.isFinite(spec.initial), `${label}: ${field}.initial`);
        if (spec.min !== undefined) assert.ok(spec.initial >= spec.min, `${label}: ${field}.initial below min`);
        if (spec.max !== undefined) assert.ok(spec.initial <= spec.max, `${label}: ${field}.initial above max`);
      } else if (typeof spec.initial === 'string') {
        assert.ok(types.includes('string'), `${label}: ${field}.initial`);
      } else if (typeof spec.initial === 'boolean') {
        assert.ok(types.includes('boolean'), `${label}: ${field}.initial`);
      } else if (Array.isArray(spec.initial)) {
        assert.ok(types.includes('array'), `${label}: ${field}.initial`);
      } else if (typeof spec.initial === 'object') {
        assert.ok(types.includes('object'), `${label}: ${field}.initial`);
      } else {
        assert.fail(`${label}: ${field}.initial has unsupported type`);
      }
    }
    for (const id of Object.keys(data.signals)) {
      const field = id.slice(data.id.length + 1);
      assert.ok(field in data.state, `${label}: signal ${id} has no state field`);
    }

    assert.ok(Array.isArray(data.resetOnStart), `${label}: resetOnStart must be an array`);
    for (const field of data.resetOnStart) assert.ok(field in data.state, `${label}: resetOnStart field ${field}`);

    components.set(data.id, { file, data });
  }

  for (const { file, data } of components.values()) {
    const label = where(file);
    for (const id of data.reads) {
      assert.ok(signals.has(id), `${label}: read signal ${id} has no owner`);
    }
  }

  for (const { file, data } of components.values()) {
    const label = where(file);
    if (data.actions !== undefined && data.actions !== null) {
      assertString(data.actions, `${label}: actions`);
      const actionsFile = resolve(dirname(file), data.actions);
      assert.ok(existsSync(actionsFile), `${label}: actions file is missing`);
      const actionsData = readJson(actionsFile);
      assert.equal(actionsData.schemaVersion, 1, `${where(actionsFile)}: schemaVersion must be 1`);
      assert.ok(Array.isArray(actionsData.actions) && actionsData.actions.length > 0, `${where(actionsFile)}: actions must be a non-empty array`);
      for (const action of actionsData.actions) {
        assertString(action.type, `${where(actionsFile)}: action.type`);
        assert.equal(action.target, data.id, `${where(actionsFile)}: ${action.type}.target`);
        assert.ok(isPlainObject(action.payload), `${where(actionsFile)}: ${action.type}.payload`);
        for (const [field, spec] of Object.entries(action.payload)) {
          assert.ok(['number', 'string', 'boolean', 'object'].includes(spec.type), `${where(actionsFile)}: ${action.type}.${field}.type`);
          if (spec.type === 'number') {
            assertNumber(spec.min, `${where(actionsFile)}: ${action.type}.${field}.min`);
            assertNumber(spec.max, `${where(actionsFile)}: ${action.type}.${field}.max`);
            assert.ok(spec.min <= spec.max, `${where(actionsFile)}: ${action.type}.${field} min/max`);
          }
          if (spec.enum !== undefined) {
            assert.ok(Array.isArray(spec.enum) && spec.enum.length > 0, `${where(actionsFile)}: ${action.type}.${field}.enum`);
          }
          if (spec.required !== undefined) assert.equal(typeof spec.required, 'boolean', `${where(actionsFile)}: ${action.type}.${field}.required`);
          if (spec.default !== undefined && spec.type === 'number') assertNumber(spec.default, `${where(actionsFile)}: ${action.type}.${field}.default`);
        }
        if (!actions.has(action.type)) actions.set(action.type, []);
        actions.get(action.type).push({ owner: data.id, file: actionsFile, spec: action });
      }
    }

    if (data.parameters !== undefined && data.parameters !== null) {
      assertString(data.parameters, `${label}: parameters`);
      const parametersFile = resolve(dirname(file), data.parameters);
      assert.ok(existsSync(parametersFile), `${label}: parameters file is missing`);
      const parametersData = readJson(parametersFile);
      assert.equal(parametersData.schemaVersion, 1, `${where(parametersFile)}: schemaVersion must be 1`);
      assert.equal(parametersData.owner, data.id, `${where(parametersFile)}: owner`);
      assert.ok(Array.isArray(parametersData.parameters) && parametersData.parameters.length > 0, `${where(parametersFile)}: parameters must be a non-empty array`);
      for (const parameter of parametersData.parameters) {
        assertString(parameter.id, `${where(parametersFile)}: parameter.id`);
        assert.ok(parameter.id.startsWith(`${data.id}.`), `${where(parametersFile)}: ${parameter.id} must start with ${data.id}.`);
        assert.ok(!parameterIds.has(parameter.id), `${where(parametersFile)}: duplicate parameter ${parameter.id}`);
        assertString(parameter.unit, `${where(parametersFile)}: ${parameter.id}.unit`);
        assert.ok(allowedStatuses.has(parameter.status), `${where(parametersFile)}: ${parameter.id}.status`);
        assertRange(parameter.range, `${where(parametersFile)}: ${parameter.id}.range`);
        if (parameter.value === null) {
          assert.equal(parameter.status, 'unset', `${where(parametersFile)}: ${parameter.id} null value must be unset`);
        } else {
          assertNumber(parameter.value, `${where(parametersFile)}: ${parameter.id}.value`);
          assert.notEqual(parameter.status, 'unset', `${where(parametersFile)}: ${parameter.id} unset must be null`);
          assert.ok(parameter.value >= parameter.range[0], `${where(parametersFile)}: ${parameter.id} below range`);
          if (parameter.range[1] !== null) assert.ok(parameter.value <= parameter.range[1], `${where(parametersFile)}: ${parameter.id} above range`);
        }
        assertSource(parameter.source, `${where(parametersFile)}: ${parameter.id}.source`, sourceIds);
        if (['prior', 'fitted_dev', 'validated'].includes(parameter.status)) {
          assert.notEqual(parameter.source, null, `${where(parametersFile)}: ${parameter.id} needs a source`);
        }
        parameterIds.set(parameter.id, { owner: data.id, file: parametersFile, spec: parameter });
      }
    }

    if (data.readouts !== undefined && data.readouts !== null) {
      assertString(data.readouts, `${label}: readouts`);
      const readoutsFile = resolve(dirname(file), data.readouts);
      assert.ok(existsSync(readoutsFile), `${label}: readouts file is missing`);
      const readoutsData = readJson(readoutsFile);
      assert.equal(readoutsData.schemaVersion, 1, `${where(readoutsFile)}: schemaVersion must be 1`);
      assert.equal(readoutsData.owner, data.id, `${where(readoutsFile)}: owner`);
      assert.ok(Array.isArray(readoutsData.readouts) && readoutsData.readouts.length > 0, `${where(readoutsFile)}: readouts must be a non-empty array`);
      for (const readout of readoutsData.readouts) {
        assertString(readout.id, `${where(readoutsFile)}: readout.id`);
        assert.ok(!readoutIds.has(readout.id), `${where(readoutsFile)}: duplicate readout ${readout.id}`);
        assert.ok(isPlainObject(readout.scale), `${where(readoutsFile)}: ${readout.id}.scale`);
        assertNumber(readout.scale.min, `${where(readoutsFile)}: ${readout.id}.scale.min`);
        assertNumber(readout.scale.max, `${where(readoutsFile)}: ${readout.id}.scale.max`);
        assert.ok(readout.scale.min < readout.scale.max, `${where(readoutsFile)}: ${readout.id}.scale min/max`);
        assertString(readout.scale.unit, `${where(readoutsFile)}: ${readout.id}.scale.unit`);
        if (readout.scale.anchors !== undefined) {
          assert.ok(isPlainObject(readout.scale.anchors), `${where(readoutsFile)}: ${readout.id}.scale.anchors`);
          for (const [key, value] of Object.entries(readout.scale.anchors)) {
            assertString(key, `${where(readoutsFile)}: ${readout.id}.scale.anchors key`);
            assertString(value, `${where(readoutsFile)}: ${readout.id}.scale.anchors.${key}`);
          }
        }
        assert.ok(['any', 'postprandialOnly'].includes(readout.time), `${where(readoutsFile)}: ${readout.id}.time`);
        assertString(readout.missing, `${where(readoutsFile)}: ${readout.id}.missing`);
        assert.ok(Array.isArray(readout.sources), `${where(readoutsFile)}: ${readout.id}.sources`);
        for (const source of readout.sources) assertSource(source, `${where(readoutsFile)}: ${readout.id}.sources`, sourceIds);
        assert.ok(signals.has(`${data.id}.${readout.id}`), `${where(readoutsFile)}: ${readout.id} has no matching signal`);
        readoutIds.set(readout.id, { owner: data.id, file: readoutsFile, spec: readout });
      }
    }
  }

  const scenarioFiles = readdirSync(scenariosRoot)
    .filter((file) => file.endsWith('.json'))
    .map((file) => join(scenariosRoot, file));
  assert.ok(scenarioFiles.length > 0, 'expected at least one scenario');
  const scenarioIds = new Set();
  for (const file of scenarioFiles) {
    const data = readJson(file);
    const label = where(file);
    assert.equal(data.schemaVersion, 1, `${label}: schemaVersion must be 1`);
    assertString(data.id, `${label}: id`);
    assert.ok(!scenarioIds.has(data.id), `${label}: duplicate scenario id ${data.id}`);
    scenarioIds.add(data.id);
    assertSource(data.source, `${label}: source`, sourceIds);
    assert.ok(isPlainObject(data.protocol), `${label}: protocol`);
    assert.ok(Array.isArray(data.protocol.actions) && data.protocol.actions.length > 0, `${label}: protocol.actions`);
    for (const action of data.protocol.actions) {
      assertNumber(action.atMin, `${label}: action.atMin`);
      assertString(action.type, `${label}: action.type`);
      const handlers = actions.get(action.type);
      assert.ok(handlers?.length > 0, `${label}: no handler for action ${action.type}`);
      const handler = action.target === undefined ? handlers[0] : handlers.find((candidate) => candidate.owner === action.target);
      assert.ok(handler, `${label}: no handler for action ${action.type} on ${action.target}`);
      const allowedFields = new Set(['atMin', 'type', 'target', ...Object.keys(handler.spec.payload)]);
      for (const field of Object.keys(action)) assert.ok(allowedFields.has(field), `${label}: unknown action field ${field}`);
      for (const [field, spec] of Object.entries(handler.spec.payload)) {
        if (spec.required) assert.ok(field in action, `${label}: action ${action.type} misses ${field}`);
        if (!(field in action)) continue;
        const value = action[field];
        if (spec.type === 'number') {
          assertNumber(value, `${label}: ${field}`);
          assert.ok(value >= spec.min, `${label}: ${field} below min`);
          assert.ok(value <= spec.max, `${label}: ${field} above max`);
        } else if (spec.type === 'string') {
          assertString(value, `${label}: ${field}`);
          if (spec.enum) assert.ok(spec.enum.includes(value), `${label}: ${field} not in enum`);
        } else if (spec.type === 'boolean') {
          assert.equal(typeof value, 'boolean', `${label}: ${field}`);
        } else if (spec.type === 'object') {
          assert.ok(isPlainObject(value), `${label}: ${field}`);
        }
      }
    }
    if (data.baseline !== undefined) {
      assert.ok(isPlainObject(data.baseline), `${label}: baseline`);
      for (const [signal, value] of Object.entries(data.baseline)) {
        assert.ok(signals.has(signal), `${label}: baseline signal ${signal} has no owner`);
        assertNumber(value, `${label}: baseline.${signal}`);
        const range = signals.get(signal).spec.range;
        assert.ok(value >= range[0], `${label}: baseline.${signal} below range`);
        if (range[1] !== null) assert.ok(value <= range[1], `${label}: baseline.${signal} above range`);
      }
    }
    assert.ok(isPlainObject(data.observe), `${label}: observe`);
    const hasAt = Array.isArray(data.observe.atMin);
    const hasPostMeal = Array.isArray(data.observe.postMealMin);
    assert.ok(hasAt !== hasPostMeal, `${label}: observe needs exactly one of atMin or postMealMin`);
    const times = hasAt ? data.observe.atMin : data.observe.postMealMin;
    assert.ok(times.length > 0, `${label}: observe times must not be empty`);
    for (const time of times) assertNumber(time, `${label}: observe time`);
    assert.ok(Array.isArray(data.observe.signals) && data.observe.signals.length > 0, `${label}: observe.signals`);
    for (const signal of data.observe.signals) assert.ok(signals.has(signal), `${label}: observe signal ${signal} has no owner`);
    if (data.expected !== undefined) {
      assert.ok(isPlainObject(data.expected), `${label}: expected`);
      for (const [signal, values] of Object.entries(data.expected)) {
        assert.ok(data.observe.signals.includes(signal), `${label}: expected signal ${signal} is not observed`);
        assert.ok(Array.isArray(values), `${label}: expected.${signal}`);
        assert.equal(values.length, times.length, `${label}: expected.${signal} length`);
        for (const value of values) {
          if (value === null) continue;
          assertNumber(value, `${label}: expected.${signal}`);
          const range = signals.get(signal).spec.range;
          assert.ok(value >= range[0], `${label}: expected.${signal} below range`);
          if (range[1] !== null) assert.ok(value <= range[1], `${label}: expected.${signal} above range`);
        }
      }
    }
  }

  const manifest = readJson(join(repoRoot, 'body-modules.json'));
  assert.ok(Array.isArray(manifest.scripts), 'body-modules.json scripts must be an array');
  assert.ok(Array.isArray(manifest.startupScripts), 'body-modules.json startupScripts must be an array');
  for (const entry of manifest.scripts) {
    const modulePath = typeof entry === 'string' ? entry : entry.path;
    assertString(modulePath, 'body-modules.json script path');
    assert.ok(existsSync(resolve(repoRoot, modulePath)), `body-modules.json script is missing: ${modulePath}`);
  }
  for (const entry of manifest.startupScripts) {
    assertString(entry, 'body-modules.json startup path');
    assert.ok(existsSync(resolve(repoRoot, entry)), `body-modules.json startup script is missing: ${entry}`);
  }
});
