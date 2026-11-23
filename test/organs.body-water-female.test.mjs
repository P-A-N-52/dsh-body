import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import { assertJsonValue } from '../json-safe.js';
import * as baseWater from '../organs/human-compartments/body-water/water.ts';
import * as femaleWater from '../organs/human-compartments/body-water/water.female.ts';

const stomachStub = {
  id: 'stomach',
  initialState: { waterVolumeMl: 0 },
  fields: {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferOut: ['smallIntestine.waterVolumeMl'],
    },
  },
};

const smallIntestineStub = {
  id: 'smallIntestine',
  initialState: { waterVolumeMl: 0 },
  fields: {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['stomach.waterVolumeMl'],
      transferOut: ['bodyFluid.waterVolumeMl'],
    },
  },
};

const bladderStub = {
  id: 'bladder',
  initialState: { volumeMl: 0 },
  fields: {
    volumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  },
};

const skinStub = {
  id: 'skin',
  initialState: { sweatRequestMl: 0, sweatVolumeMl: 0 },
  fields: {
    sweatRequestMl: { unit: 'mL', mode: 'absolute' },
    sweatVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  },
};

const lungsStub = {
  id: 'lungs',
  initialState: { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 },
  fields: {
    respiratoryWaterLossRequestMl: { unit: 'mL', mode: 'absolute' },
    respiratoryWaterLossMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  },
};

const uterusStub = {
  id: 'uterus',
  initialState: { endometriumRelative: 0.1, crampMm: 0, bleedingRequestMl: 0, bleedingMl: 0 },
  fields: {
    endometriumRelative: { unit: '1', mode: 'absolute' },
    crampMm: { unit: 'mm', mode: 'absolute' },
    bleedingRequestMl: { unit: 'mL', mode: 'absolute' },
    bleedingMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  },
};

const zeroLungs = { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 };
const zeroSkin = { sweatRequestMl: 0, sweatVolumeMl: 0 };

function registryFor(module, { withUterus }) {
  const parts = [stomachStub, smallIntestineStub, bladderStub, skinStub, lungsStub];
  if (withUterus) parts.push(uterusStub);
  parts.push({ id: module.id, initialState: module.initialState, fields: module.fields });
  return createFieldRegistry(parts);
}

function runHeartbeat(module, {
  fluid = { waterVolumeMl: 30000, waterDeficit: 0 },
  kidney = { urineProductionRequestMl: 0 },
  lungs = zeroLungs,
  skin = zeroSkin,
  uterus,
  dt = 60,
} = {}) {
  const transfers = [];
  let written;
  module.heartbeat({
    read: (partId) => {
      if (partId === 'bodyFluid') return fluid;
      if (partId === 'kidney') return kidney;
      if (partId === 'lungs') return lungs;
      if (partId === 'skin') return skin;
      if (partId === 'uterus') return uterus;
      return undefined;
    },
    actions: [],
    dt,
    simulatedSeconds: 60,
    write: (next) => { written = next; },
    transfer: (...args) => { transfers.push(args); },
  });
  return { written, transfers };
}

function round(module, {
  fluid = { waterVolumeMl: 30000, waterDeficit: 0 },
  kidney = { urineProductionRequestMl: 0 },
  lungs = zeroLungs,
  skin = zeroSkin,
  uterus = { ...uterusStub.initialState },
  writes = {},
  intestineInflowMl = 0,
  withUterus = module === femaleWater,
} = {}) {
  const fieldRegistry = registryFor(module, { withUterus });
  const snapshotParts = {
    stomach: { waterVolumeMl: 0 },
    smallIntestine: { waterVolumeMl: 0 },
    bladder: { volumeMl: 0 },
    skin: { ...zeroSkin },
    lungs: { ...zeroLungs },
    bodyFluid: fluid,
    kidney,
    uterus: { ...uterus },
  };
  const { written, transfers } = runHeartbeat(module, { fluid, kidney, lungs, skin, uterus });
  const writtenSnapshot = structuredClone(written);
  const allTransfers = transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
    caller: module.id,
    fromPart,
    fromField,
    toPart,
    toField,
    amount,
  }));
  if (intestineInflowMl > 0) {
    allTransfers.push({
      caller: 'smallIntestine',
      fromPart: 'smallIntestine',
      fromField: 'waterVolumeMl',
      toPart: 'bodyFluid',
      toField: 'waterVolumeMl',
      amount: intestineInflowMl,
    });
  }
  const nextWrites = { bodyFluid: structuredClone(writtenSnapshot), ...writes };
  if (intestineInflowMl > 0) {
    nextWrites.smallIntestine = { waterVolumeMl: intestineInflowMl };
  }
  const next = applyOperations({
    registry: fieldRegistry,
    snapshotParts,
    writes: nextWrites,
    transfers: allTransfers,
  });
  return { written: writtenSnapshot, transfers, next };
}

test('the female body fluid variant keeps the base contract and appends the uterus outlet', () => {
  assert.equal(femaleWater.id, 'bodyFluid');
  assert.deepEqual(femaleWater.actionTypes, []);
  assert.deepEqual(femaleWater.initialState, { waterVolumeMl: 30000, waterDeficit: 0 });
  assert.deepEqual(femaleWater.fields, {
    waterVolumeMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['smallIntestine.waterVolumeMl'],
      transferOut: [
        'bladder.volumeMl',
        'lungs.respiratoryWaterLossMl',
        'skin.sweatVolumeMl',
        'uterus.bleedingMl',
      ],
    },
    waterDeficit: { unit: '1', mode: 'absolute' },
  });

  assert.equal(baseWater.id, 'bodyFluid');
  assert.deepEqual(baseWater.actionTypes, []);
  assert.deepEqual(baseWater.fields.waterVolumeMl.transferOut, [
    'bladder.volumeMl',
    'lungs.respiratoryWaterLossMl',
    'skin.sweatVolumeMl',
  ]);
  assert.deepEqual(baseWater.initialState, femaleWater.initialState);
  assertJsonValue(femaleWater.initialState);
});

test('the uterus outlet is paid after kidney, lung and sweat from the round-start remainder', () => {
  const { written, transfers, next } = round(femaleWater, {
    fluid: { waterVolumeMl: 100, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 40 },
    lungs: { respiratoryWaterLossRequestMl: 30, respiratoryWaterLossMl: 0 },
    skin: { sweatRequestMl: 20, sweatVolumeMl: 0 },
    uterus: { bleedingRequestMl: 50, bleedingMl: 0 },
  });

  assert.deepEqual(written, { waterVolumeMl: 100, waterDeficit: 1 });
  assert.deepEqual(transfers, [
    ['bodyFluid', 'waterVolumeMl', 'bladder', 'volumeMl', 40],
    ['bodyFluid', 'waterVolumeMl', 'lungs', 'respiratoryWaterLossMl', 30],
    ['bodyFluid', 'waterVolumeMl', 'skin', 'sweatVolumeMl', 20],
    ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 10],
  ]);
  assert.equal(next.bodyFluid.waterVolumeMl, 0);
  assert.equal(next.uterus.bleedingMl, 10);
  assertJsonValue(written);
});

test('the uterus request is paid exactly when it fits and starved when earlier outlets spend the water', () => {
  const fits = round(femaleWater, {
    fluid: { waterVolumeMl: 100, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 10 },
    uterus: { bleedingRequestMl: 2.5, bleedingMl: 0 },
  });
  assert.deepEqual(fits.transfers[3], ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 2.5]);
  assert.equal(fits.next.uterus.bleedingMl, 2.5);

  const starved = round(femaleWater, {
    fluid: { waterVolumeMl: 40, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 100 },
    uterus: { bleedingRequestMl: 2.5, bleedingMl: 0 },
  });
  assert.deepEqual(starved.transfers[3], ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 0]);
  assert.equal(starved.next.bodyFluid.waterVolumeMl, 0);
  assert.equal(starved.next.uterus.bleedingMl, 0);
});

test('a zero or missing uterus request reproduces the three-outlet body point by point', () => {
  const scenarios = [
    {},
    {
      fluid: { waterVolumeMl: 40, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 100 },
      skin: { sweatRequestMl: 50, sweatVolumeMl: 0 },
    },
    {
      fluid: { waterVolumeMl: 30, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 10 },
      lungs: { respiratoryWaterLossRequestMl: 30, respiratoryWaterLossMl: 0 },
      skin: { sweatRequestMl: 10, sweatVolumeMl: 0 },
    },
    {
      fluid: { waterVolumeMl: 30250, waterDeficit: 0 },
      kidney: { urineProductionRequestMl: 0.7 },
      lungs: { respiratoryWaterLossRequestMl: 0.3, respiratoryWaterLossMl: 0 },
      skin: { sweatRequestMl: 0.6, sweatVolumeMl: 0 },
    },
  ];
  const uterusReadings = [
    { bleedingRequestMl: 0, bleedingMl: 0 },
    { bleedingRequestMl: 0 },
    { bleedingRequestMl: -5, bleedingMl: 0 },
    { bleedingRequestMl: Number.NaN, bleedingMl: 0 },
    {},
    undefined,
  ];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const base = runHeartbeat(baseWater, scenario);
    for (const uterus of uterusReadings) {
      const female = runHeartbeat(femaleWater, { ...scenario, uterus });
      assert.deepEqual(female.written, base.written, `scenario ${scenarioIndex}`);
      assert.deepEqual(female.transfers.slice(0, 3), base.transfers, `scenario ${scenarioIndex}`);
      assert.deepEqual(
        female.transfers[3],
        ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 0],
        `scenario ${scenarioIndex}`,
      );
    }
  }
});

test('uterus.bleedingMl receives the fourth transfer through its paired transferIn', () => {
  const { transfers, next } = round(femaleWater, {
    fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 10 },
    uterus: { bleedingRequestMl: 12, bleedingMl: 0 },
  });

  assert.deepEqual(transfers[3], ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 12]);
  assert.equal(next.uterus.bleedingMl, 12);
  assert.equal(next.bodyFluid.waterVolumeMl, 30000 - 10 - 12);

  assert.throws(
    () => registryFor(femaleWater, { withUterus: false }),
    /transferOut target "uterus\.bleedingMl" is not declared/,
  );
});

test('the female water ledger includes cumulative uterus.bleedingMl over rounds', () => {
  const initialWaterMl = 30000;
  const fieldRegistry = registryFor(femaleWater, { withUterus: true });
  let parts = {
    stomach: { waterVolumeMl: 0 },
    smallIntestine: { waterVolumeMl: 0 },
    bladder: { volumeMl: 0 },
    skin: { sweatRequestMl: 0.6, sweatVolumeMl: 0 },
    lungs: { respiratoryWaterLossRequestMl: 0.3, respiratoryWaterLossMl: 0 },
    bodyFluid: { waterVolumeMl: initialWaterMl, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 0.7 },
    uterus: { ...uterusStub.initialState, bleedingRequestMl: 2 },
  };
  let cumulativeIntakeMl = 0;
  let cumulativeBleedingMl = 0;

  for (let index = 0; index < 20; index++) {
    const inflowMl = index % 4 === 0 ? 50 : 0;
    cumulativeIntakeMl += inflowMl;
    const uterusPrev = { ...parts.uterus, bleedingMl: 0 };
    const { written, transfers } = runHeartbeat(femaleWater, {
      fluid: parts.bodyFluid,
      kidney: parts.kidney,
      lungs: parts.lungs,
      skin: parts.skin,
      uterus: uterusPrev,
    });
    const allTransfers = transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
      caller: femaleWater.id,
      fromPart,
      fromField,
      toPart,
      toField,
      amount,
    }));
    if (inflowMl > 0) {
      allTransfers.push({
        caller: 'smallIntestine',
        fromPart: 'smallIntestine',
        fromField: 'waterVolumeMl',
        toPart: 'bodyFluid',
        toField: 'waterVolumeMl',
        amount: inflowMl,
      });
    }
    const writes = {
      bodyFluid: written,
      uterus: { ...uterusPrev, bleedingRequestMl: 2, bleedingMl: 0 },
    };
    if (inflowMl > 0) writes.smallIntestine = { waterVolumeMl: inflowMl };
    const next = applyOperations({
      registry: fieldRegistry,
      snapshotParts: parts,
      writes,
      transfers: allTransfers,
    });
    cumulativeBleedingMl += next.uterus.bleedingMl;
    parts = next;

    const ledgerMl = next.bodyFluid.waterVolumeMl
      + next.bladder.volumeMl
      + next.skin.sweatVolumeMl
      + next.lungs.respiratoryWaterLossMl
      + cumulativeBleedingMl;
    assert.ok(
      Math.abs(initialWaterMl + cumulativeIntakeMl - ledgerMl) < 1e-6,
      `round ${index + 1}: ledger ${ledgerMl}`,
    );
  }

  assert.ok(cumulativeBleedingMl > 0);
  assert.ok(Math.abs(cumulativeBleedingMl - 20 * 2) < 1e-9, `bleeding ${cumulativeBleedingMl}`);
  assert.ok(parts.bodyFluid.waterVolumeMl > initialWaterMl);
});
