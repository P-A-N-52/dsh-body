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

// 水账测试只需要乳腺的请求字段与 milkMl 接收端；lactoseG 的 glucose 配对由 glucose 测试覆盖。
const mammaryGlandsStub = {
  id: 'mammaryGlands',
  initialState: {
    milkRequestMl: 0,
    milkMl: 0,
    lactoseRequestG: 0,
    lactoseG: 0,
    fullnessMm: 0,
  },
  fields: {
    milkRequestMl: { unit: 'mL', mode: 'absolute' },
    milkMl: {
      unit: 'mL',
      mode: 'absolute',
      transferIn: ['bodyFluid.waterVolumeMl'],
    },
  },
};

const zeroLungs = { respiratoryWaterLossRequestMl: 0, respiratoryWaterLossMl: 0 };
const zeroSkin = { sweatRequestMl: 0, sweatVolumeMl: 0 };

function registryFor(module, { withUterus, withMammary }) {
  const parts = [stomachStub, smallIntestineStub, bladderStub, skinStub, lungsStub];
  if (withUterus) parts.push(uterusStub);
  if (withMammary) parts.push(mammaryGlandsStub);
  parts.push({ id: module.id, initialState: module.initialState, fields: module.fields });
  return createFieldRegistry(parts);
}

function runHeartbeat(module, {
  fluid = { waterVolumeMl: 30000, waterDeficit: 0 },
  kidney = { urineProductionRequestMl: 0 },
  lungs = zeroLungs,
  skin = zeroSkin,
  uterus,
  mammaryGlands,
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
      if (partId === 'mammaryGlands') return mammaryGlands;
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
  mammaryGlands = { ...mammaryGlandsStub.initialState },
  writes = {},
  intestineInflowMl = 0,
  withUterus = module === femaleWater,
  withMammary = module === femaleWater,
} = {}) {
  const fieldRegistry = registryFor(module, { withUterus, withMammary });
  const snapshotParts = {
    stomach: { waterVolumeMl: 0 },
    smallIntestine: { waterVolumeMl: 0 },
    bladder: { volumeMl: 0 },
    skin: { ...zeroSkin },
    lungs: { ...zeroLungs },
    bodyFluid: fluid,
    kidney,
    uterus: { ...uterus },
    mammaryGlands: { ...mammaryGlands },
  };
  const { written, transfers } = runHeartbeat(module, {
    fluid,
    kidney,
    lungs,
    skin,
    uterus,
    mammaryGlands,
  });
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

test('the female body fluid variant keeps the base contract and appends the uterus and mammary outlets', () => {
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
        'mammaryGlands.milkMl',
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

test('the uterus and mammary outlets are paid after kidney, lung and sweat from the round-start remainder', () => {
  const { written, transfers, next } = round(femaleWater, {
    fluid: { waterVolumeMl: 100, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 40 },
    lungs: { respiratoryWaterLossRequestMl: 30, respiratoryWaterLossMl: 0 },
    skin: { sweatRequestMl: 20, sweatVolumeMl: 0 },
    uterus: { bleedingRequestMl: 4, bleedingMl: 0 },
    mammaryGlands: {
      ...mammaryGlandsStub.initialState,
      milkRequestMl: 10,
      milkMl: 0,
    },
  });

  assert.deepEqual(written, { waterVolumeMl: 100, waterDeficit: 1 });
  assert.deepEqual(transfers, [
    ['bodyFluid', 'waterVolumeMl', 'bladder', 'volumeMl', 40],
    ['bodyFluid', 'waterVolumeMl', 'lungs', 'respiratoryWaterLossMl', 30],
    ['bodyFluid', 'waterVolumeMl', 'skin', 'sweatVolumeMl', 20],
    ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 4],
    ['bodyFluid', 'waterVolumeMl', 'mammaryGlands', 'milkMl', 6],
  ]);
  assert.equal(next.bodyFluid.waterVolumeMl, 0);
  assert.equal(next.uterus.bleedingMl, 4);
  assert.equal(next.mammaryGlands.milkMl, 6);
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

test('a zero or missing uterus or mammary request reproduces the three-outlet body point by point', () => {
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
  const outletReadings = [
    {},
    { request: 0 },
    { request: -5 },
    { request: Number.NaN },
    { request: undefined },
  ];

  for (const [scenarioIndex, scenario] of scenarios.entries()) {
    const base = runHeartbeat(baseWater, scenario);
    for (const { request } of outletReadings) {
      const uterus = request === undefined
        ? undefined
        : { bleedingRequestMl: request, bleedingMl: 0 };
      const mammaryGlands = request === undefined
        ? undefined
        : { milkRequestMl: request, milkMl: 0 };
      const female = runHeartbeat(femaleWater, { ...scenario, uterus, mammaryGlands });
      assert.deepEqual(female.written, base.written, `scenario ${scenarioIndex}`);
      assert.deepEqual(female.transfers.slice(0, 3), base.transfers, `scenario ${scenarioIndex}`);
      assert.deepEqual(
        female.transfers[3],
        ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 0],
        `scenario ${scenarioIndex}`,
      );
      assert.deepEqual(
        female.transfers[4],
        ['bodyFluid', 'waterVolumeMl', 'mammaryGlands', 'milkMl', 0],
        `scenario ${scenarioIndex}`,
      );
    }
  }
});

test('mammary milk is paid last and is starved by the earlier four outlets', () => {
  const fits = round(femaleWater, {
    fluid: { waterVolumeMl: 100, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 10 },
    uterus: { bleedingRequestMl: 4, bleedingMl: 0 },
    mammaryGlands: { ...mammaryGlandsStub.initialState, milkRequestMl: 2.5 },
  });
  assert.deepEqual(
    fits.transfers[4],
    ['bodyFluid', 'waterVolumeMl', 'mammaryGlands', 'milkMl', 2.5],
  );
  assert.equal(fits.next.mammaryGlands.milkMl, 2.5);

  const starved = round(femaleWater, {
    fluid: { waterVolumeMl: 100, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 95 },
    uterus: { bleedingRequestMl: 4, bleedingMl: 0 },
    mammaryGlands: { ...mammaryGlandsStub.initialState, milkRequestMl: 5 },
  });
  assert.deepEqual(starved.transfers[3], ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 4]);
  assert.deepEqual(
    starved.transfers[4],
    ['bodyFluid', 'waterVolumeMl', 'mammaryGlands', 'milkMl', 1],
  );
  assert.equal(starved.next.bodyFluid.waterVolumeMl, 0);
  assert.equal(starved.next.mammaryGlands.milkMl, 1);

  const noRemainder = round(femaleWater, {
    fluid: { waterVolumeMl: 100, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 96 },
    uterus: { bleedingRequestMl: 4, bleedingMl: 0 },
    mammaryGlands: { ...mammaryGlandsStub.initialState, milkRequestMl: 5 },
  });
  assert.deepEqual(
    noRemainder.transfers[4],
    ['bodyFluid', 'waterVolumeMl', 'mammaryGlands', 'milkMl', 0],
  );
  assert.equal(noRemainder.next.mammaryGlands.milkMl, 0);
});

test('uterus.bleedingMl and mammaryGlands.milkMl receive the fourth and fifth transfers through their paired transferIn', () => {
  const { transfers, next } = round(femaleWater, {
    fluid: { waterVolumeMl: 30000, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 10 },
    uterus: { bleedingRequestMl: 12, bleedingMl: 0 },
    mammaryGlands: { ...mammaryGlandsStub.initialState, milkRequestMl: 1.5 },
  });

  assert.deepEqual(transfers[3], ['bodyFluid', 'waterVolumeMl', 'uterus', 'bleedingMl', 12]);
  assert.deepEqual(
    transfers[4],
    ['bodyFluid', 'waterVolumeMl', 'mammaryGlands', 'milkMl', 1.5],
  );
  assert.equal(next.uterus.bleedingMl, 12);
  assert.equal(next.mammaryGlands.milkMl, 1.5);
  assert.equal(next.bodyFluid.waterVolumeMl, 30000 - 10 - 12 - 1.5);

  assert.throws(
    () => registryFor(femaleWater, { withUterus: false, withMammary: true }),
    /transferOut target "uterus\.bleedingMl" is not declared/,
  );
  assert.throws(
    () => registryFor(femaleWater, { withUterus: true, withMammary: false }),
    /transferOut target "mammaryGlands\.milkMl" is not declared/,
  );
});

test('the female water ledger includes cumulative uterus.bleedingMl and mammaryGlands.milkMl over rounds', () => {
  const initialWaterMl = 30000;
  const fieldRegistry = registryFor(femaleWater, { withUterus: true, withMammary: true });
  let parts = {
    stomach: { waterVolumeMl: 0 },
    smallIntestine: { waterVolumeMl: 0 },
    bladder: { volumeMl: 0 },
    skin: { sweatRequestMl: 0.6, sweatVolumeMl: 0 },
    lungs: { respiratoryWaterLossRequestMl: 0.3, respiratoryWaterLossMl: 0 },
    bodyFluid: { waterVolumeMl: initialWaterMl, waterDeficit: 0 },
    kidney: { urineProductionRequestMl: 0.7 },
    uterus: { ...uterusStub.initialState, bleedingRequestMl: 2 },
    mammaryGlands: { ...mammaryGlandsStub.initialState, milkRequestMl: 0.5 },
  };
  let cumulativeIntakeMl = 0;
  let cumulativeBleedingMl = 0;
  let cumulativeMilkMl = 0;

  for (let index = 0; index < 20; index++) {
    const inflowMl = index % 4 === 0 ? 50 : 0;
    cumulativeIntakeMl += inflowMl;
    const uterusPrev = { ...parts.uterus, bleedingMl: 0 };
    const mammaryPrev = { ...parts.mammaryGlands, milkMl: 0 };
    const { written, transfers } = runHeartbeat(femaleWater, {
      fluid: parts.bodyFluid,
      kidney: parts.kidney,
      lungs: parts.lungs,
      skin: parts.skin,
      uterus: uterusPrev,
      mammaryGlands: mammaryPrev,
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
      mammaryGlands: { ...mammaryPrev, milkRequestMl: 0.5, milkMl: 0 },
    };
    if (inflowMl > 0) writes.smallIntestine = { waterVolumeMl: inflowMl };
    const next = applyOperations({
      registry: fieldRegistry,
      snapshotParts: parts,
      writes,
      transfers: allTransfers,
    });
    cumulativeBleedingMl += next.uterus.bleedingMl;
    cumulativeMilkMl += next.mammaryGlands.milkMl;
    parts = next;

    const ledgerMl = next.bodyFluid.waterVolumeMl
      + next.bladder.volumeMl
      + next.skin.sweatVolumeMl
      + next.lungs.respiratoryWaterLossMl
      + cumulativeBleedingMl
      + cumulativeMilkMl;
    assert.ok(
      Math.abs(initialWaterMl + cumulativeIntakeMl - ledgerMl) < 1e-6,
      `round ${index + 1}: ledger ${ledgerMl}`,
    );
  }

  assert.ok(cumulativeBleedingMl > 0);
  assert.ok(Math.abs(cumulativeBleedingMl - 20 * 2) < 1e-9, `bleeding ${cumulativeBleedingMl}`);
  assert.ok(Math.abs(cumulativeMilkMl - 20 * 0.5) < 1e-9, `milk ${cumulativeMilkMl}`);
  assert.ok(parts.bodyFluid.waterVolumeMl > initialWaterMl);
});
