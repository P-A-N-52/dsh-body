import test from 'node:test';
import assert from 'node:assert/strict';
import { applyOperations, createFieldRegistry } from '../gateway/operations.js';
import { assertJsonValue } from '../json-safe.js';
import {
  actionTypes,
  fields,
  heartbeat,
  id,
  initialState,
} from '../organs/human-compartments/glucose/glucose.female.ts';
import * as rootGlucose from '../organs/human-compartments/glucose/glucose.ts';
import * as bladder from '../organs/human-organs/bladder/storage.ts';
import * as bodyFluid from '../organs/human-compartments/body-water/water.ts';
import * as skin from '../organs/human-organs/skin/sweat.ts';
import * as smallIntestine from '../organs/human-organs/small-intestine/water-absorption.ts';
import * as stomachHydration from '../organs/human-organs/stomach/hydration.ts';

const baselineMassG = 12.69;
const distributionVolumeDl = 141;
const residualHalfTimeMin = 60;

const kidneyGlucoseStub = {
  id: 'kidneyGlucose',
  initialState: { excretionRequestG: 0, excretedGlucoseG: 0 },
  fields: {
    excretionRequestG: { unit: 'g', mode: 'absolute' },
    excretedGlucoseG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
  },
};

const muscleInitialState = {
  uptakeG: 0,
  uptakeRequestG: 0,
  glycogenG: 0,
  glycogenConsumedG: 0,
};

const muscleGlucoseStub = {
  id: 'muscleGlucose',
  initialState: muscleInitialState,
  fields: {
    uptakeG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
    uptakeRequestG: { unit: 'g', mode: 'absolute' },
    glycogenG: { unit: 'g', mode: 'absolute' },
    glycogenConsumedG: { unit: 'g', mode: 'absolute' },
  },
};

// 用最小 stub 锁定 glucose 消费的 liver 请求字段与 transfer 目标，不导入 liver 模块以保持隔室测试独立。
const liverInitialState = {
  glycogenCapacityG: 100,
  glycogenG: 80,
  storageG: 0,
  storageRequestG: 0,
  outputG: 0,
};

const liverStub = {
  id: 'liver',
  initialState: liverInitialState,
  fields: {
    glycogenCapacityG: { unit: 'g', mode: 'absolute' },
    glycogenG: {
      unit: 'g',
      mode: 'absolute',
      transferOut: ['glucose.glucoseMassG'],
    },
    storageG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
    storageRequestG: { unit: 'g', mode: 'absolute' },
    outputG: { unit: 'g', mode: 'absolute' },
  },
};

// 最小肾糖异生 stub：只锁定 glucose 声明的入账来源与 transfer 对端，不导入肾模块。
const kidneyGluconeogenesisInitialState = { glucoseOutputG: 0 };

const kidneyGluconeogenesisStub = {
  id: 'kidneyGluconeogenesis',
  initialState: kidneyGluconeogenesisInitialState,
  fields: {
    glucoseOutputG: {
      unit: 'g',
      mode: 'absolute',
      transferOut: ['glucose.glucoseMassG'],
    },
  },
};

// 最小乳腺 stub：只锁定 glucose 消费的请求字段与 lactoseG 接收端，不导入乳腺模块。
const mammaryInitialState = {
  milkRequestMl: 0,
  milkMl: 0,
  lactoseRequestG: 0,
  lactoseG: 0,
  fullnessMm: 0,
};

const mammaryGlandsStub = {
  id: 'mammaryGlands',
  initialState: mammaryInitialState,
  fields: {
    milkRequestMl: { unit: 'mL', mode: 'absolute' },
    milkMl: { unit: 'mL', mode: 'absolute' },
    lactoseRequestG: { unit: 'g', mode: 'absolute' },
    lactoseG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
    },
    fullnessMm: { unit: 'mm', mode: 'absolute' },
  },
};

function snapshotFor(
  state,
  {
    insulin = 1,
    request = 0,
    liverRequest = 0,
    muscleRequest = 0,
    mammaryRequest = 0,
    liver,
    muscle,
    mammary,
    withPancreas = true,
    withKidney = true,
    withLiver = true,
    withMuscle = true,
    withMammary = true,
  } = {},
) {
  const parts = { glucose: state };
  if (withLiver) {
    parts.liver = { ...liverInitialState, storageRequestG: liverRequest, ...liver };
  }
  if (withMuscle) {
    parts.muscleGlucose = { ...muscleInitialState, uptakeRequestG: muscleRequest, ...muscle };
  }
  if (withMammary) {
    parts.mammaryGlands = {
      ...mammaryInitialState,
      lactoseRequestG: mammaryRequest,
      ...mammary,
    };
  }
  if (withPancreas) parts.pancreasEndocrine = { insulinRelative: insulin };
  if (withKidney) parts.kidneyGlucose = { excretionRequestG: request, excretedGlucoseG: 0 };
  return parts;
}

function observeRound(state, options = {}) {
  const parts = snapshotFor(state, options);
  const writes = [];
  const transfers = [];
  const io = {
    read: (partId) => parts[partId],
    actions: [],
    dt: options.dt ?? 60,
    simulatedSeconds: 60,
    write: (next) => { writes.push(next); },
    transfer: (...args) => { transfers.push(args); },
  };
  return { io, writes, transfers };
}

function round(state, options = {}) {
  const { io, writes, transfers } = observeRound(state, options);
  heartbeat(io);
  return { written: writes[0], transfers };
}

function rootRound(state, options = {}) {
  const { io, writes, transfers } = observeRound(state, options);
  rootGlucose.heartbeat(io);
  return { written: writes[0], transfers };
}

// 与脚本逐位同式的结算期望：残余清除只作用于超基线质量，请求按 policy 顺序从
// 轮初质量扣除残余清除后的余额支付，write 值为转移前的 post-residual 质量。
function settlement({
  massG,
  dt = 60,
  request = 0,
  liverRequest = 0,
  muscleRequest = 0,
  mammaryRequest = 0,
}) {
  const excessG = Math.max(0, massG - baselineMassG);
  const disposedG = excessG * (1 - 2 ** (-(dt / 60) / residualHalfTimeMin));
  const afterResidualG = massG - disposedG;
  const renalG = Math.min(Math.max(0, request), afterResidualG);
  const liverPaidG = Math.min(liverRequest, afterResidualG - renalG);
  const musclePaidG = Math.min(muscleRequest, afterResidualG - renalG - liverPaidG);
  const mammaryPaidG = Math.min(
    mammaryRequest,
    afterResidualG - renalG - liverPaidG - musclePaidG,
  );
  const finalMassG = afterResidualG - renalG - liverPaidG - musclePaidG - mammaryPaidG;
  return {
    excessG,
    disposedG,
    afterResidualG,
    renalG,
    liverPaidG,
    musclePaidG,
    mammaryPaidG,
    finalMassG,
  };
}

function renalTransferG(transfers) {
  return transfers
    .filter(([fromPart, fromField, toPart, toField]) => fromPart === 'glucose'
      && fromField === 'glucoseMassG'
      && toPart === 'kidneyGlucose'
      && toField === 'excretedGlucoseG')
    .reduce((sum, [, , , , amount]) => sum + amount, 0);
}

function muscleTransferG(transfers) {
  return transfers
    .filter(([fromPart, fromField, toPart, toField]) => fromPart === 'glucose'
      && fromField === 'glucoseMassG'
      && toPart === 'muscleGlucose'
      && toField === 'uptakeG')
    .reduce((sum, [, , , , amount]) => sum + amount, 0);
}

function liverTransferG(transfers) {
  return transfers
    .filter(([fromPart, fromField, toPart, toField]) => fromPart === 'glucose'
      && fromField === 'glucoseMassG'
      && toPart === 'liver'
      && toField === 'storageG')
    .reduce((sum, [, , , , amount]) => sum + amount, 0);
}

function mammaryTransferG(transfers) {
  return transfers
    .filter(([fromPart, fromField, toPart, toField]) => fromPart === 'glucose'
      && fromField === 'glucoseMassG'
      && toPart === 'mammaryGlands'
      && toField === 'lactoseG')
    .reduce((sum, [, , , , amount]) => sum + amount, 0);
}

function registry() {
  return createFieldRegistry([
    {
      id: 'smallIntestine',
      initialState: { carbohydrateG: 0 },
      fields: {
        carbohydrateG: {
          unit: 'g',
          mode: 'absolute',
          transferOut: ['glucose.glucoseMassG'],
        },
      },
    },
    kidneyGlucoseStub,
    muscleGlucoseStub,
    liverStub,
    kidneyGluconeogenesisStub,
    mammaryGlandsStub,
    { id, initialState, fields },
  ]);
}

function applyRound({
  state,
  request = 0,
  liverRequest = 0,
  muscleRequest = 0,
  mammaryRequest = 0,
  kidneyRequestAfter = 0,
  inflowG = 0,
  dt = 60,
  liver,
  muscle,
  mammary,
}) {
  const { written, transfers } = round(state, {
    request,
    liverRequest,
    muscleRequest,
    mammaryRequest,
    dt,
    liver,
    muscle,
    mammary,
  });
  const writtenBeforeTransfer = structuredClone(written);
  const next = applyOperations({
    registry: registry(),
    snapshotParts: {
      glucose: state,
      kidneyGlucose: { excretionRequestG: request, excretedGlucoseG: 0 },
      muscleGlucose: { ...muscleInitialState, ...muscle },
      liver: { ...liverInitialState, ...liver },
      mammaryGlands: { ...mammaryInitialState, lactoseRequestG: mammaryRequest, ...mammary },
      smallIntestine: { carbohydrateG: inflowG },
    },
    writes: {
      glucose: written,
      kidneyGlucose: { excretionRequestG: kidneyRequestAfter, excretedGlucoseG: 0 },
      smallIntestine: { carbohydrateG: inflowG },
    },
    transfers: [
      ...transfers.map(([fromPart, fromField, toPart, toField, amount]) => ({
        caller: id,
        fromPart,
        fromField,
        toPart,
        toField,
        amount,
      })),
      ...(inflowG > 0
        ? [{
          caller: 'smallIntestine',
          fromPart: 'smallIntestine',
          fromField: 'carbohydrateG',
          toPart: 'glucose',
          toField: 'glucoseMassG',
          amount: inflowG,
        }]
        : []),
    ],
  });
  return { written: writtenBeforeTransfer, transfers, next };
}

test('glucose exports the compartment contract with the excess signal and baseline state', () => {
  assert.equal(id, 'glucose');
  assert.deepEqual(actionTypes, []);
  assert.deepEqual(fields, {
    glucoseMassG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: [
        'smallIntestine.carbohydrateG',
        'liver.glycogenG',
        'kidneyGluconeogenesis.glucoseOutputG',
      ],
      transferOut: [
        'kidneyGlucose.excretedGlucoseG',
        'liver.storageG',
        'muscleGlucose.uptakeG',
        'mammaryGlands.lactoseG',
      ],
    },
    concentrationMgDl: { unit: 'mg/dL', mode: 'absolute' },
    disposedGlucoseG: { unit: 'g', mode: 'absolute' },
    excessMassG: { unit: 'g', mode: 'absolute' },
  });
  assert.deepEqual(
    Object.keys(initialState).sort(),
    ['concentrationMgDl', 'disposedGlucoseG', 'excessMassG', 'glucoseMassG'],
  );
  assert.ok(Math.abs(initialState.glucoseMassG - baselineMassG) < 1e-9);
  assert.ok(Math.abs(initialState.concentrationMgDl - 90) < 1e-9);
  assert.ok(
    Math.abs(initialState.glucoseMassG * 1000 / initialState.concentrationMgDl - distributionVolumeDl) < 1e-9,
  );
  assert.equal(initialState.disposedGlucoseG, 0);
  assert.equal(initialState.excessMassG, 0);
});

test('the root glucose entry omits the mammary lactose sink and needs no mammary part', () => {
  assert.equal(rootGlucose.id, 'glucose');
  assert.deepEqual(rootGlucose.fields.glucoseMassG.transferOut, [
    'kidneyGlucose.excretedGlucoseG',
    'liver.storageG',
    'muscleGlucose.uptakeG',
  ]);
  assert.doesNotThrow(() => createFieldRegistry([
    {
      id: 'smallIntestine',
      initialState: { carbohydrateG: 0 },
      fields: {
        carbohydrateG: {
          unit: 'g',
          mode: 'absolute',
          transferOut: ['glucose.glucoseMassG'],
        },
      },
    },
    kidneyGlucoseStub,
    muscleGlucoseStub,
    liverStub,
    kidneyGluconeogenesisStub,
    {
      id: rootGlucose.id,
      initialState: rootGlucose.initialState,
      fields: rootGlucose.fields,
    },
  ]));
});

test('glucoseMassG declares the kidney gluconeogenesis inflow after liver glycogen', () => {
  const expected = [
    'smallIntestine.carbohydrateG',
    'liver.glycogenG',
    'kidneyGluconeogenesis.glucoseOutputG',
  ];
  assert.deepEqual(fields.glucoseMassG.transferIn, expected);
  assert.deepEqual(rootGlucose.fields.glucoseMassG.transferIn, expected);
});

test('a glucose manifest without kidney gluconeogenesis fails on the undeclared source', () => {
  assert.throws(
    () => createFieldRegistry([
      {
        id: 'smallIntestine',
        initialState: { carbohydrateG: 0 },
        fields: {
          carbohydrateG: {
            unit: 'g',
            mode: 'absolute',
            transferOut: ['glucose.glucoseMassG'],
          },
        },
      },
      kidneyGlucoseStub,
      muscleGlucoseStub,
      liverStub,
      mammaryGlandsStub,
      { id, initialState, fields },
    ]),
    (error) => {
      assert.match(error.message, /glucose/);
      assert.match(error.message, /glucoseMassG/);
      assert.match(error.message, /kidneyGluconeogenesis\.glucoseOutputG/);
      assert.match(error.message, /not declared/);
      return true;
    },
  );
});

test('the root glucose entry ignores the mammary lactose request', () => {
  const massG = baselineMassG + 30;
  const state = { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const expected = settlement({ massG, liverRequest: 2, muscleRequest: 3 });

  const withoutMammary = rootRound(state, {
    withMammary: false,
    liverRequest: 2,
    muscleRequest: 3,
    mammaryRequest: 4,
  });
  assert.equal(mammaryTransferG(withoutMammary.transfers), 0);
  assert.equal(liverTransferG(withoutMammary.transfers), expected.liverPaidG);
  assert.equal(muscleTransferG(withoutMammary.transfers), expected.musclePaidG);

  const withMammary = rootRound(state, {
    liverRequest: 2,
    muscleRequest: 3,
    mammaryRequest: 4,
  });
  assert.equal(mammaryTransferG(withMammary.transfers), 0);
  assert.equal(liverTransferG(withMammary.transfers), expected.liverPaidG);
  assert.equal(muscleTransferG(withMammary.transfers), expected.musclePaidG);
  assert.ok(
    Math.abs(withMammary.written.glucoseMassG - expected.afterResidualG) < 1e-12,
    'a mammary request must not change the root pool write',
  );
});

test('a hydrated body without kidney glucose fails on the glucose transfer target', () => {
  const modules = [
    { id: stomachHydration.id, initialState: stomachHydration.initialState, fields: stomachHydration.fields },
    { id: smallIntestine.id, initialState: smallIntestine.initialState, fields: smallIntestine.fields },
    { id: bodyFluid.id, initialState: bodyFluid.initialState, fields: bodyFluid.fields },
    {
      id: 'colon',
      initialState: { residueWaterMl: 0, reclaimedWaterMl: 0 },
      fields: {
        residueWaterMl: {
          unit: 'mL',
          mode: 'absolute',
          transferIn: ['smallIntestine.waterVolumeMl'],
        },
        reclaimedWaterMl: {
          unit: 'mL',
          mode: 'absolute',
          transferOut: ['bodyFluid.waterVolumeMl'],
        },
      },
    },
    {
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
    },
    { id: skin.id, initialState: skin.initialState, fields: skin.fields },
    kidneyGluconeogenesisStub,
    { id, initialState, fields },
    { id: bladder.id, initialState: bladder.initialState, fields: bladder.fields },
  ];
  assert.throws(
    () => createFieldRegistry(modules),
    (error) => {
      assert.match(error.message, /kidneyGlucose/, 'the error must name the missing target part');
      assert.match(error.message, /excretedGlucoseG/, 'the error must name the missing target field');
      assert.match(error.message, /glucose/, 'the error must name the source part');
      assert.match(error.message, /glucoseMassG/, 'the error must name the source field');
      assert.equal(
        error.message.includes('smallIntestine'),
        false,
        'the complete small intestine pair must not be reported as missing',
      );
      return true;
    },
  );
});

test('a glucose registry without muscle glucose fails on the muscle transfer target', () => {
  const modules = [
    {
      id: 'smallIntestine',
      initialState: { carbohydrateG: 0 },
      fields: {
        carbohydrateG: {
          unit: 'g',
          mode: 'absolute',
          transferOut: ['glucose.glucoseMassG'],
        },
      },
    },
    kidneyGlucoseStub,
    liverStub,
    kidneyGluconeogenesisStub,
    { id, initialState, fields },
  ];
  assert.throws(
    () => createFieldRegistry(modules),
    (error) => {
      assert.match(error.message, /muscleGlucose\.uptakeG/);
      assert.equal(
        error.message.includes('kidneyGlucose'),
        false,
        'the complete kidney pair must not be reported as missing',
      );
      return true;
    },
  );
});

test('a glucose registry without liver fails on the liver transfer declarations', () => {
  const modules = [
    {
      id: 'smallIntestine',
      initialState: { carbohydrateG: 0 },
      fields: {
        carbohydrateG: {
          unit: 'g',
          mode: 'absolute',
          transferOut: ['glucose.glucoseMassG'],
        },
      },
    },
    kidneyGlucoseStub,
    muscleGlucoseStub,
    kidneyGluconeogenesisStub,
    { id, initialState, fields },
  ];
  assert.throws(
    () => createFieldRegistry(modules),
    (error) => {
      assert.match(error.message, /liver\.storageG|liver\.glycogenG/);
      assert.match(error.message, /not declared/);
      return true;
    },
  );
});

test('liver and muscleGlucose are required parts at heartbeat time', () => {
  const state = { glucoseMassG: baselineMassG + 30, concentrationMgDl: 0, disposedGlucoseG: 0 };
  assert.throws(() => round(state, { withLiver: false }), /liver/);
  assert.throws(() => round(state, { withMuscle: false }), /muscleGlucose/);
});

test('residual disposal uses the residual half-time and ignores the insulin signal', () => {
  const massG = baselineMassG + 30;
  const state = { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 };
  for (const dt of [60, 120]) {
    const expected = settlement({ massG, dt });
    for (const insulin of [0, 0.5, 1, 2]) {
      const label = `dt ${dt}s, insulin ${insulin}`;
      const { written, transfers } = round(state, { dt, insulin });
      assert.ok(
        Math.abs(written.disposedGlucoseG - expected.disposedG) < 1e-12,
        `residual disposal at ${label}`,
      );
      assert.ok(
        Math.abs(written.excessMassG - expected.excessG) < 1e-12,
        `excess signal at ${label}`,
      );
      assert.ok(
        Math.abs(written.glucoseMassG - expected.afterResidualG) < 1e-12,
        `post-residual mass at ${label}`,
      );
      assert.equal(
        written.concentrationMgDl,
        massG * 1000 / distributionVolumeDl,
        `concentration at ${label}`,
      );
      assert.equal(transfers.length, 0, `no request, no transfer at ${label}`);
    }
  }
});

test('baseline and below-baseline mass produce zero excess and zero disposal', () => {
  for (const massG of [baselineMassG, 6]) {
    const { written, transfers } = round({
      glucoseMassG: massG,
      concentrationMgDl: 0,
      disposedGlucoseG: 0,
    });
    assert.equal(written.excessMassG, 0);
    assert.equal(written.disposedGlucoseG, 0);
    assert.equal(written.glucoseMassG, massG);
    assert.ok(
      Math.abs(written.concentrationMgDl - massG * 1000 / distributionVolumeDl) < 1e-9,
    );
    assert.equal(transfers.length, 0);
  }
});

test('settles kidney, liver, muscle and mammary at their round-start requests', () => {
  const massG = baselineMassG + 30;
  const expected = settlement({
    massG,
    request: 1,
    liverRequest: 2,
    muscleRequest: 3,
    mammaryRequest: 4,
  });
  const { written, transfers } = round(
    { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
    { request: 1, liverRequest: 2, muscleRequest: 3, mammaryRequest: 4 },
  );

  assert.equal(renalTransferG(transfers), expected.renalG);
  assert.equal(liverTransferG(transfers), expected.liverPaidG);
  assert.equal(muscleTransferG(transfers), expected.musclePaidG);
  assert.equal(mammaryTransferG(transfers), expected.mammaryPaidG);
  assert.equal(expected.renalG, 1);
  assert.equal(expected.liverPaidG, 2);
  assert.equal(expected.musclePaidG, 3);
  assert.equal(expected.mammaryPaidG, 4);
  assert.ok(Math.abs(written.glucoseMassG - expected.afterResidualG) < 1e-12);
  assert.ok(
    written.glucoseMassG >= renalTransferG(transfers)
      + liverTransferG(transfers)
      + muscleTransferG(transfers)
      + mammaryTransferG(transfers),
    'the write value must cover all four outflows',
  );
});

test('the mammary lactose request is settled last and clamped by the remaining pool', () => {
  const massG = baselineMassG + 30;
  const state = { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const afterResidualG = settlement({ massG }).afterResidualG;

  const mammaryLast = round(state, {
    request: 1,
    liverRequest: 2,
    muscleRequest: 3,
    mammaryRequest: 1e6,
  });
  assert.equal(renalTransferG(mammaryLast.transfers), 1);
  assert.equal(liverTransferG(mammaryLast.transfers), 2);
  assert.equal(muscleTransferG(mammaryLast.transfers), 3);
  assert.ok(
    Math.abs(mammaryTransferG(mammaryLast.transfers) - (afterResidualG - 6)) < 1e-12,
  );

  const muscleDrains = round(state, { muscleRequest: 1e6, mammaryRequest: 4 });
  assert.equal(mammaryTransferG(muscleDrains.transfers), 0);

  const liverDrains = round(state, { liverRequest: 1e6, mammaryRequest: 4 });
  assert.equal(mammaryTransferG(liverDrains.transfers), 0);

  const renalDrains = round(state, { request: 1e6, mammaryRequest: 4 });
  assert.equal(mammaryTransferG(renalDrains.transfers), 0);
});

test('clamps later settlements when the pool cannot pay every request', () => {
  const massG = baselineMassG + 30;
  const state = { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const afterResidualG = settlement({ massG }).afterResidualG;

  const renalFirst = round(state, { request: 1e6, liverRequest: 2, muscleRequest: 3 });
  assert.ok(Math.abs(renalTransferG(renalFirst.transfers) - afterResidualG) < 1e-12);
  assert.equal(liverTransferG(renalFirst.transfers), 0);
  assert.equal(muscleTransferG(renalFirst.transfers), 0);

  const liverSecond = round(state, { liverRequest: 1e6, muscleRequest: 3 });
  assert.equal(renalTransferG(liverSecond.transfers), 0);
  assert.ok(Math.abs(liverTransferG(liverSecond.transfers) - afterResidualG) < 1e-12);
  assert.equal(muscleTransferG(liverSecond.transfers), 0);

  const muscleThird = round(state, { liverRequest: 1, muscleRequest: 1e6 });
  assert.equal(renalTransferG(muscleThird.transfers), 0);
  assert.equal(liverTransferG(muscleThird.transfers), 1);
  assert.ok(Math.abs(muscleTransferG(muscleThird.transfers) - (afterResidualG - 1)) < 1e-12);
  assert.ok(
    Math.abs(
      liverSecond.written.glucoseMassG
        - (renalTransferG(liverSecond.transfers)
          + liverTransferG(liverSecond.transfers)
          + muscleTransferG(liverSecond.transfers)),
    ) < 1e-12,
    'the clamped write value equals the settled outflows when the pool is drained',
  );
});

test('D + L_paid + U_paid + M_paid equals M_start - M_final - X and the pool conserves', () => {
  const cases = [
    { massG: baselineMassG + 30, request: 1, liverRequest: 2, muscleRequest: 3, mammaryRequest: 4 },
    { massG: baselineMassG + 30, request: 1e6, liverRequest: 2, muscleRequest: 3, mammaryRequest: 4 },
    { massG: baselineMassG + 30, request: 0, liverRequest: 1e6, muscleRequest: 3, mammaryRequest: 4 },
    { massG: baselineMassG + 30, request: 0, liverRequest: 1, muscleRequest: 1e6, mammaryRequest: 4 },
    { massG: baselineMassG + 30, request: 0, liverRequest: 1, muscleRequest: 3, mammaryRequest: 1e6 },
    {
      massG: baselineMassG + 0.001,
      request: 0.0002,
      liverRequest: 0.0006,
      muscleRequest: 0.0006,
      mammaryRequest: 0.0006,
    },
    { massG: 6, request: 1, liverRequest: 1, muscleRequest: 1, mammaryRequest: 1 },
  ];
  for (const { massG, request, liverRequest, muscleRequest, mammaryRequest } of cases) {
    const label = `M ${massG} g, R ${request}, L ${liverRequest}, U ${muscleRequest}, G ${mammaryRequest}`;
    const expected = settlement({ massG, request, liverRequest, muscleRequest, mammaryRequest });
    const { written, transfers, next } = applyRound({
      state: { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
      request,
      liverRequest,
      muscleRequest,
      mammaryRequest,
    });
    const renalG = renalTransferG(transfers);
    const liverG = liverTransferG(transfers);
    const muscleG = muscleTransferG(transfers);
    const mammaryG = mammaryTransferG(transfers);

    assert.ok(Math.abs(renalG - expected.renalG) < 1e-12, `X at ${label}`);
    assert.ok(Math.abs(liverG - expected.liverPaidG) < 1e-12, `L_paid at ${label}`);
    assert.ok(Math.abs(muscleG - expected.musclePaidG) < 1e-12, `U_paid at ${label}`);
    assert.ok(Math.abs(mammaryG - expected.mammaryPaidG) < 1e-12, `M_paid at ${label}`);
    assert.ok(
      Math.abs(
        written.disposedGlucoseG + liverG + muscleG + mammaryG
          - (massG - next.glucose.glucoseMassG - renalG),
      ) < 1e-12,
      `D + L_paid + U_paid + M_paid at ${label}`,
    );
    assert.ok(
      Math.abs(
        next.glucose.glucoseMassG + renalG + written.disposedGlucoseG
          + liverG + muscleG + mammaryG - massG,
      ) < 1e-12,
      `M_start conservation at ${label}`,
    );
    assert.ok(
      Math.abs((next.liver?.storageG ?? 0) - liverG) < 1e-12,
      `liver receipt at ${label}`,
    );
    assert.ok(
      Math.abs((next.muscleGlucose?.uptakeG ?? 0) - muscleG) < 1e-12,
      `muscle receipt at ${label}`,
    );
    assert.ok(
      Math.abs((next.mammaryGlands?.lactoseG ?? 0) - mammaryG) < 1e-12,
      `mammary receipt at ${label}`,
    );
    assert.ok(
      Math.abs(next.kidneyGlucose.excretedGlucoseG - renalG) < 1e-12,
      `kidney receipt at ${label}`,
    );
  }
});

test('invalid liver, muscle or mammary requests fail the round before any write', () => {
  const state = { glucoseMassG: baselineMassG + 30, concentrationMgDl: 0, disposedGlucoseG: 0 };
  for (const [label, options] of [
    ['liver NaN', { liver: { storageRequestG: Number.NaN } }],
    ['liver negative', { liver: { storageRequestG: -1 } }],
    ['liver infinite', { liver: { storageRequestG: Number.POSITIVE_INFINITY } }],
    ['liver string', { liver: { storageRequestG: '1' } }],
    ['liver missing', { liver: { storageRequestG: undefined } }],
    ['muscle NaN', { muscle: { uptakeRequestG: Number.NaN } }],
    ['muscle negative', { muscle: { uptakeRequestG: -1 } }],
    ['muscle infinite', { muscle: { uptakeRequestG: Number.POSITIVE_INFINITY } }],
    ['muscle string', { muscle: { uptakeRequestG: '1' } }],
    ['muscle missing', { muscle: { uptakeRequestG: undefined } }],
    ['mammary NaN', { mammary: { lactoseRequestG: Number.NaN } }],
    ['mammary negative', { mammary: { lactoseRequestG: -1 } }],
    ['mammary infinite', { mammary: { lactoseRequestG: Number.POSITIVE_INFINITY } }],
    ['mammary string', { mammary: { lactoseRequestG: '1' } }],
    ['mammary missing', { mammary: { lactoseRequestG: undefined } }],
  ]) {
    const { io, writes, transfers } = observeRound(state, options);
    assert.throws(() => heartbeat(io), `${label} must fail the round`);
    assert.equal(writes.length, 0, `${label} must not write`);
    assert.equal(transfers.length, 0, `${label} must not transfer`);
  }
});

test('missing kidney glucose means no renal transfer while invalid requests fail the round', () => {
  const massG = baselineMassG + 30;
  const expected = settlement({
    massG,
    liverRequest: 2,
    muscleRequest: 3,
    mammaryRequest: 4,
  });
  const { written, transfers } = round(
    { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
    { withKidney: false, liverRequest: 2, muscleRequest: 3, mammaryRequest: 4 },
  );
  assert.equal(renalTransferG(transfers), 0);
  assert.equal(liverTransferG(transfers), expected.liverPaidG);
  assert.equal(muscleTransferG(transfers), expected.musclePaidG);
  assert.equal(mammaryTransferG(transfers), expected.mammaryPaidG);
  assert.ok(Math.abs(written.disposedGlucoseG - expected.disposedG) < 1e-12);

  for (const request of [Number.NaN, -1, Number.POSITIVE_INFINITY, '1']) {
    assert.throws(
      () => round(
        { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
        { request },
      ),
      `request ${String(request)} must fail the round`,
    );
  }
  assert.equal(
    renalTransferG(round(
      { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
      { request: 0 },
    ).transfers),
    0,
  );
});

test('missing mammary glands mean no lactose transfer while invalid requests fail the round', () => {
  const massG = baselineMassG + 30;
  const expected = settlement({ massG, liverRequest: 2, muscleRequest: 3 });
  const { written, transfers } = round(
    { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
    { withMammary: false, liverRequest: 2, muscleRequest: 3 },
  );
  assert.equal(renalTransferG(transfers), 0);
  assert.equal(liverTransferG(transfers), expected.liverPaidG);
  assert.equal(muscleTransferG(transfers), expected.musclePaidG);
  assert.equal(mammaryTransferG(transfers), 0);
  assert.ok(Math.abs(written.disposedGlucoseG - expected.disposedG) < 1e-12);

  assert.equal(
    mammaryTransferG(round(
      { glucoseMassG: massG, concentrationMgDl: 0, disposedGlucoseG: 0 },
      { mammaryRequest: 0 },
    ).transfers),
    0,
  );
});

test('a round-start renal request drains the pool before liver and muscle', () => {
  const startMassG = baselineMassG + 30;
  const expected = settlement({ massG: startMassG, request: 100, liverRequest: 2, muscleRequest: 3 });
  const state = { glucoseMassG: startMassG, concentrationMgDl: 0, disposedGlucoseG: 0 };

  const { written, transfers, next } = applyRound({
    state,
    request: 100,
    liverRequest: 2,
    muscleRequest: 3,
  });

  assert.ok(Math.abs(renalTransferG(transfers) - expected.afterResidualG) < 1e-12);
  assert.equal(liverTransferG(transfers), 0);
  assert.equal(muscleTransferG(transfers), 0);
  assert.ok(Math.abs(written.glucoseMassG - expected.afterResidualG) < 1e-12);
  assert.ok(Math.abs(next.glucose.glucoseMassG) < 1e-12);
  assert.ok(Math.abs(next.glucose.disposedGlucoseG - expected.disposedG) < 1e-12);
  assert.ok(Math.abs(next.kidneyGlucose.excretedGlucoseG - expected.afterResidualG) < 1e-12);
  assert.equal(next.muscleGlucose?.uptakeG ?? 0, 0);
  assert.equal(next.liver?.storageG ?? 0, 0);
  assert.ok(
    Math.abs(
      next.glucose.glucoseMassG
        + next.kidneyGlucose.excretedGlucoseG
        + next.glucose.disposedGlucoseG
        - startMassG,
    ) < 1e-12,
  );
});

test('a same-round intestinal inflow cannot pay the round-start requests', () => {
  const startMassG = baselineMassG + 1;
  const inflowG = 10;
  const expected = settlement({ massG: startMassG, request: 20, liverRequest: 1, muscleRequest: 1 });
  const state = { glucoseMassG: startMassG, concentrationMgDl: 0, disposedGlucoseG: 0 };

  const { transfers, next } = applyRound({
    state,
    request: 20,
    liverRequest: 1,
    muscleRequest: 1,
    inflowG,
  });

  assert.ok(Math.abs(renalTransferG(transfers) - expected.afterResidualG) < 1e-12);
  assert.equal(liverTransferG(transfers), 0);
  assert.equal(muscleTransferG(transfers), 0);
  assert.ok(Math.abs(next.glucose.glucoseMassG - inflowG) < 1e-12);
  assert.ok(Math.abs(next.kidneyGlucose.excretedGlucoseG - expected.afterResidualG) < 1e-12);
  assert.ok(
    Math.abs(
      next.glucose.glucoseMassG
        + next.kidneyGlucose.excretedGlucoseG
        + next.glucose.disposedGlucoseG
        - (startMassG + inflowG),
    ) < 1e-12,
  );
});

test('a request written this round is not paid in the same round', () => {
  const startMassG = baselineMassG + 1;
  const state = { glucoseMassG: startMassG, concentrationMgDl: 0, disposedGlucoseG: 0 };
  const { written, transfers } = round(state, { request: 0 });
  assert.equal(renalTransferG(transfers), 0);

  const next = applyOperations({
    registry: registry(),
    snapshotParts: {
      glucose: state,
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
    },
    writes: {
      glucose: written,
      kidneyGlucose: { excretionRequestG: 20, excretedGlucoseG: 0 },
    },
    transfers: [],
  });
  assert.equal(next.kidneyGlucose.excretionRequestG, 20);
  assert.equal(next.kidneyGlucose.excretedGlucoseG, 0);
  assert.ok(Math.abs(next.glucose.glucoseMassG - written.glucoseMassG) < 1e-12);
});

test('a negative stored mass is clamped to zero and disposes nothing', () => {
  const { written, transfers } = round({
    glucoseMassG: -5,
    concentrationMgDl: 0,
    disposedGlucoseG: 0,
  });
  assert.equal(written.glucoseMassG, 0);
  assert.equal(written.concentrationMgDl, 0);
  assert.equal(written.disposedGlucoseG, 0);
  assert.equal(written.excessMassG, 0);
  assert.equal(transfers.length, 0);
});

test('same-round intestine inflow lands after write, so concentration rises only next round', () => {
  const smallIntestine = {
    id: 'smallIntestine',
    initialState: { carbohydrateG: 0 },
    fields: {
      carbohydrateG: { unit: 'g', mode: 'absolute', transferOut: ['glucose.glucoseMassG'] },
    },
  };
  const fieldRegistry = createFieldRegistry([
    smallIntestine,
    kidneyGlucoseStub,
    muscleGlucoseStub,
    liverStub,
    kidneyGluconeogenesisStub,
    mammaryGlandsStub,
    { id, initialState, fields },
  ]);

  const start = { ...initialState };
  const { written } = round(start);
  assert.ok(Math.abs(written.concentrationMgDl - 90) < 1e-9);

  const next = applyOperations({
    registry: fieldRegistry,
    snapshotParts: {
      smallIntestine: { carbohydrateG: 10 },
      glucose: start,
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
    },
    writes: {
      glucose: written,
      smallIntestine: { carbohydrateG: 10 },
      kidneyGlucose: { excretionRequestG: 0, excretedGlucoseG: 0 },
    },
    transfers: [{
      caller: 'smallIntestine',
      fromPart: 'smallIntestine',
      fromField: 'carbohydrateG',
      toPart: 'glucose',
      toField: 'glucoseMassG',
      amount: 10,
    }],
  });

  assert.ok(Math.abs(next.glucose.glucoseMassG - (baselineMassG + 10)) < 1e-9);
  assert.ok(Math.abs(next.glucose.concentrationMgDl - 90) < 1e-9);

  const later = round(next.glucose);
  assert.ok(
    Math.abs(later.written.concentrationMgDl - ((baselineMassG + 10) * 1000 / distributionVolumeDl)) < 1e-9,
  );
  const expected = settlement({ massG: baselineMassG + 10 });
  assert.ok(Math.abs(later.written.excessMassG - expected.excessG) < 1e-12);
  assert.ok(Math.abs(later.written.disposedGlucoseG - expected.disposedG) < 1e-12);
  assert.ok(Math.abs(later.written.glucoseMassG - expected.afterResidualG) < 1e-12);
});

test('residual disposal alone conserves the initial excess above baseline', () => {
  let state = {
    glucoseMassG: baselineMassG + 30,
    concentrationMgDl: 90,
    disposedGlucoseG: 0,
    excessMassG: 0,
  };
  let disposedG = 0;
  for (let index = 0; index < 200; index++) {
    const { written, transfers } = round(state);
    assert.equal(transfers.length, 0);
    disposedG += written.disposedGlucoseG;
    state = written;
    assert.ok(
      state.glucoseMassG >= baselineMassG - 1e-9,
      `round ${index + 1} fell below baseline`,
    );
  }
  assert.ok(Math.abs((state.glucoseMassG - baselineMassG) + disposedG - 30) < 1e-6);
});

test('an old save without excessMassG derives it from the round-start mass', () => {
  const state = {
    glucoseMassG: baselineMassG + 30,
    concentrationMgDl: 0,
    disposedGlucoseG: 0,
  };
  const { written } = round(state);
  assert.ok(Math.abs(written.excessMassG - 30) < 1e-12);

  const stale = round({ ...state, excessMassG: 999 }).written;
  assert.equal(stale.excessMassG, written.excessMassG);
});

test('a liver-initiated release enters glucose through the declared transferIn', () => {
  const lowMassG = 6;
  const glycogenG = 5;
  const releaseG = 2;
  const next = applyOperations({
    registry: registry(),
    snapshotParts: {
      glucose: { glucoseMassG: lowMassG, concentrationMgDl: 0, disposedGlucoseG: 0 },
      liver: { ...liverInitialState, glycogenG, storageG: 0, outputG: 0 },
    },
    writes: {
      liver: { ...liverInitialState, glycogenG, storageG: 0, outputG: releaseG },
    },
    transfers: [{
      caller: 'liver',
      fromPart: 'liver',
      fromField: 'glycogenG',
      toPart: 'glucose',
      toField: 'glucoseMassG',
      amount: releaseG,
    }],
  });
  assert.equal(next.glucose.glucoseMassG, lowMassG + releaseG);
  assert.equal(next.liver.glycogenG, glycogenG - releaseG);
  assert.equal(next.liver.outputG, releaseG);
  assert.equal(next.liver.storageG, 0);
});

test('glucose output is finite and JSON-safe', () => {
  const cases = [
    { state: { ...initialState }, options: {} },
    {
      state: { glucoseMassG: baselineMassG + 30, concentrationMgDl: 0, disposedGlucoseG: 0 },
      options: { request: 5, liverRequest: 1, muscleRequest: 2, mammaryRequest: 3 },
    },
    {
      state: { glucoseMassG: 6, concentrationMgDl: 0, disposedGlucoseG: 0 },
      options: { request: 0, liverRequest: 0, muscleRequest: 0, mammaryRequest: 1 },
    },
    {
      state: { glucoseMassG: -5, concentrationMgDl: 0, disposedGlucoseG: 0 },
      options: {},
    },
  ];
  for (const { state, options } of cases) {
    const { written } = round(state, options);
    for (const [field, value] of Object.entries(written)) {
      assert.ok(Number.isFinite(value), `${field} must be finite`);
    }
    assert.doesNotThrow(() => assertJsonValue(written));
    assert.deepEqual(JSON.parse(JSON.stringify(written)), written);
  }
});
