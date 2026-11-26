/*
 * 骨骼肌摄糖聚合器核心（部位 `muscleGlucose`）；正常入口 `glucose-uptake.ts` 与缺区域
 * 变体（如 `glucose-uptake.no-limbs.ts`）只传入各自实际加载的区域份额。
 *
 * 聚合器不再持有肌糖原，只保留摄糖请求与区域分配：每轮读轮初 `glucose.excessMassG` 与
 * `pancreasEndocrine.insulinPmolL`（按基线 60 pmol/L 换算为 `insulinRelative = insulinPmolL / 60`），
 * 按自己的最大速率、半饱和过剩量与胰岛素敏感度计算
 * 本轮摄糖请求 `uptakeRequestG`；`glucose` 下一轮按序结算，经 transfer 把实际到账量转入
 * `uptakeG`。本脚本随后把轮初 `uptakeG` 按区域份额经 transfer 分配给本变体声明的区域部位。
 * 区域各自持有糖原、按轮初活动消耗，见同目录 `regions/region-core.ts`。
 *
 * 请求公式（design，`dtMin = io.dt / 60`）：
 *   response = max(0, 1 + insulinSensitivity × (insulinRelative − 1))
 *   insulinUptakeG = maxUptakeRateGPerMin
 *                  × excessMassG / (excessMassG + halfMaxExcessG)
 *                  × response
 *                  × dtMin
 *   exerciseUptakeG = physicalActivity.remainingExerciseMin > 0
 *                   ? exerciseUptakeRateGPerMin × clamp(intensity, 0, 1) × dtMin
 *                     × clamp(concentrationMgDl / 90, 0, 1.5)
 *                   : 0
 *   request = insulinUptakeG + exerciseUptakeG
 * `excessMassG` 是 `glucose` 轮初高于基线的质量（g），`insulinRelative` 是无量纲相对信号，
 * 1 为基线。`insulinSensitivity = 1` 时胰岛素响应与相对信号同比例，`0` 时对信号不敏感；
 * `excessMassG = 0` 且未运动时请求为 0，运动收缩介导摄糖在空腹时仍可从血糖摄取葡萄糖。请求只是
 * 请求，本脚本不支付：余额不足由 `glucose` 钳位，实际到账量才写进 `uptakeG`。请求每轮按
 * 轮初快照重算，不沿用上一轮值。
 *
 * 区域分配（design，份额 `source: null`）：
 *   weight(region) = 0.05（头颈）/ 0.45（躯干）/ 0.50（四肢）
 *   totalWeight    = Σ 本变体声明的 weight
 *   amount(region) = uptakeG × weight(region) / totalWeight
 * 正常入口声明三个区域；缺区域变体只声明存在的区域，因此份额自动按剩余区域归一（例如
 * 只有头和躯干时约 0.1/0.9）。`transferOut` 只列本变体声明的目标，缺区域不会因未声明的
 * transferOut 目标拒绝启动；同一清单不能同时加载两个聚合器入口（id 相同）。一个区域都
 * 没有时保留 `uptakeG` 作为在途余额，等区域加载后再分配，不凭空丢失质量。最后一笔取剩余
 * 量，保证各笔之和恰为轮初 `uptakeG`，Gateway 转账不会因浮点尾差透支。
 *
 * 旧档迁移由区域侧完成：旧档只有 `muscleGlucose.glycogenG`（总量）时，各区域在自己的
 * heartbeat 里按存在区域归一后的份额迁移；默认种子状态用迁移份额取代 300 g 的份额初值，
 * 已有真实存档状态则并入存量。本聚合器第一次 write 只写 `uptakeG` / `uptakeRequestG`，
 * 不再保留旧总量。在途 `uptakeG` 不动，仍由本脚本在重启后的第一轮按份额 transfer 给区域，
 * 区域下一轮入账。详见 `regions/region-core.ts`。
 *
 * 时序（design）：第 N 轮本脚本写请求；第 N+1 轮 `glucose` 读该请求并转出到 `uptakeG`；
 * 第 N+2 轮本脚本把到账量按份额转给区域。运动动作第 1 轮进入 `physicalActivity`，区域在
 * 第 2 轮开始消耗。`io.write` 交回的是**转出前**的 `uptakeG`，Gateway 在 transfer 阶段才
 * 扣减并加入各区域；与 `glucose`、`bodyFluid`、`liver` 的写法一致。方括号内单位：uptakeG/g、
 * uptakeRequestG/g。
 *
 * 证据：本切片没有骨骼肌摄糖速率、半饱和过剩量、胰岛素敏感度或区域肌肉质量分布的实测
 * 数据。同目录 `glucose-uptake.parameters.json` 的 `maxUptakeRateGPerMin = 0.5`、
 * `halfMaxExcessG = 20`、`insulinSensitivity = 1.0`、`glycogenUseRateGPerMin = 0.5` 与本文
 * 0.05/0.45/0.50 区域份额都是 `status: design`、`source: null` 的工程占位，不是引用值、
 * 实测值或拟合结果，不能称 validated。`SRC-DALLAMAN-2007` 只支撑“组织利用可分为胰岛素
 * 依赖与非依赖项”的结构方向，不支撑本脚本的速率、半饱和、敏感度或区域份额。
 *
 * 未建模（design）：区域肌肉绝对质量、区域血流与纤维类型、肌群疲劳/延迟酸痛、运动类型/
 * MET/强度非线性、乳酸与 Cori 循环、脂肪组织分区、个体差异、胰岛素绝对浓度与受体动力学。
 * 区域份额不随动作类型或肢体使用变化；缺区域变体只按现有区域归一，不推断缺失肢体的质量。
 *
 * 边界：`glucose` 未加载时按 `excessMassG = 0` 回退（无过剩信号，请求 0）；`pancreasEndocrine`
 * 未加载时按 `insulinPmolL = 60`（相对基线 `1`）回退。上游部位已加载但字段缺失、非有限或为负时抛错使本轮
 * 失败且不写状态、不发起 transfer，不用健康常量掩盖异常；合法 0 过剩与 0 胰岛素信号都是
 * 有效值。旧存档携带的 `glycogenG` / `glycogenConsumedG` 不参与本脚本计算，第一次 write 后
 * 不再保留。
 */
import { loadParameters, requireParameter, scaleByBodyWeight } from '../../../lib/parameters.js';

export type MuscleRegionId = 'muscleHead' | 'muscleTrunk' | 'muscleLimbs';

export type MuscleRegionShare = {
  id: MuscleRegionId;
  share: number;
};

type MuscleGlucoseState = {
  uptakeG: number;
  uptakeRequestG: number;
};

type SavedMuscleGlucoseState = {
  readonly uptakeG?: unknown;
  readonly uptakeRequestG?: unknown;
};

type GlucoseReading = {
  excessMassG?: unknown;
  concentrationMgDl?: unknown;
};

type PancreasReading = {
  insulinPmolL?: unknown;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type IO = {
  read(partId: 'muscleGlucose'): Readonly<SavedMuscleGlucoseState> | undefined;
  read(partId: MuscleRegionId): Readonly<Record<string, unknown>> | undefined;
  read(partId: 'glucose'): Readonly<GlucoseReading> | undefined;
  read(partId: 'pancreasEndocrine'): Readonly<PancreasReading> | undefined;
  read(partId: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  readonly dt: number;
  write(next: MuscleGlucoseState): void;
  transfer(
    fromPart: 'muscleGlucose',
    fromField: 'uptakeG',
    toPart: MuscleRegionId,
    toField: 'uptakeG',
    amount: number,
  ): void;
};

const parameters = loadParameters(
  new URL('./glucose-uptake.parameters.json', import.meta.url),
);
const maxUptakeRateGPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'muscleGlucose.maxUptakeRateGPerMin'),
  'muscleGlucose.maxUptakeRateGPerMin',
);
const halfMaxExcessG = scaleByBodyWeight(
  requireParameter(parameters, 'muscleGlucose.halfMaxExcessG'),
  'muscleGlucose.halfMaxExcessG',
);
const insulinSensitivity = requireParameter(
  parameters,
  'muscleGlucose.insulinSensitivity',
);
const exerciseUptakeRateGPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'muscleGlucose.exerciseUptakeRateGPerMin'),
  'muscleGlucose.exerciseUptakeRateGPerMin',
);

const REFERENCE_GLUCOSE_MG_DL = 90;
const MAX_EXERCISE_CONCENTRATION_FACTOR = 1.5;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function requireReading(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`);
  }
  return value;
}

function readActivity(
  io: IO,
): { remainingExerciseMin: number; intensity: number } | undefined {
  const activity = io.read('physicalActivity');
  if (activity === undefined) return undefined;
  const remainingExerciseMin = requireReading(
    activity.remainingExerciseMin,
    'physicalActivity.remainingExerciseMin',
  );
  const intensity = requireReading(activity.intensity, 'physicalActivity.intensity');
  if (intensity > 1) {
    throw new Error('physicalActivity.intensity must be between 0 and 1');
  }
  return { remainingExerciseMin, intensity };
}

export function createMuscleGlucose(regionShares: readonly MuscleRegionShare[]) {
  const initialState: MuscleGlucoseState = {
    uptakeG: 0,
    uptakeRequestG: 0,
  };
  const fields = {
    uptakeG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['glucose.glucoseMassG'],
      transferOut: regionShares.map(({ id }) => `${id}.uptakeG`),
    },
    uptakeRequestG: { unit: 'g', mode: 'absolute' },
  };
  const actionTypes: string[] = [];

  function heartbeat(io: IO): void {
    const prev = io.read('muscleGlucose') ?? initialState;
    const uptakeG = Math.max(0, finiteOrZero(prev.uptakeG));

    const glucose = io.read('glucose');
    const excessMassG = glucose === undefined
      ? 0
      : requireReading(glucose.excessMassG, 'glucose.excessMassG');
    const pancreas = io.read('pancreasEndocrine');
    const insulinRelative = pancreas === undefined
      ? 1
      : requireReading(pancreas.insulinPmolL, 'pancreasEndocrine.insulinPmolL') / 60;
    const activity = readActivity(io);

    const dtMin = io.dt / 60;
    const insulinResponse = Math.max(0, 1 + insulinSensitivity * (insulinRelative - 1));
    const insulinUptakeG = maxUptakeRateGPerMin
      * (excessMassG / (excessMassG + halfMaxExcessG))
      * insulinResponse
      * dtMin;

    let exerciseUptakeG = 0;
    if (activity !== undefined && activity.remainingExerciseMin > 0) {
      const concentrationMgDl = glucose === undefined
        ? 0
        : requireReading(glucose.concentrationMgDl, 'glucose.concentrationMgDl');
      exerciseUptakeG = exerciseUptakeRateGPerMin
        * activity.intensity
        * dtMin
        * clamp(concentrationMgDl / REFERENCE_GLUCOSE_MG_DL, 0, MAX_EXERCISE_CONCENTRATION_FACTOR);
    }

    const uptakeRequestG = insulinUptakeG + exerciseUptakeG;

    const presentRegions = regionShares.filter((region) => io.read(region.id) !== undefined);
    const totalShare = presentRegions.reduce((sum, region) => sum + region.share, 0);

    io.write({ uptakeG, uptakeRequestG });

    if (totalShare === 0) return;

    let remainingG = uptakeG;
    for (let index = 0; index < presentRegions.length; index++) {
      const region = presentRegions[index];
      const amountG = index === presentRegions.length - 1
        ? remainingG
        : Math.min(remainingG, uptakeG * region.share / totalShare);
      remainingG = Math.max(0, remainingG - amountG);
      if (amountG > 0) {
        io.transfer('muscleGlucose', 'uptakeG', region.id, 'uptakeG', amountG);
      }
    }
  }

  return {
    id: 'muscleGlucose' as const,
    actionTypes,
    initialState,
    fields,
    heartbeat,
  };
}
