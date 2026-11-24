/*
 * 分区骨骼肌区域共同脚本核心（`muscleHead` / `muscleTrunk` / `muscleLimbs`）；每个区域部位
 * 只由对应入口文件写入，核心不导出 `id` / `actionTypes` / `initialState` 值。
 *
 * 区域只负责自己的糖原：聚合器 `muscleGlucose` 每轮把摄糖到账量按份额经 transfer 转入本区域
 * `uptakeG`；本脚本下一轮把轮初 `uptakeG` 入账糖原，并按轮初 `physicalActivity` 消耗。
 * 区域不在本地计算份额、不读聚合器状态、不向其他部位转移；份额与归一在聚合器侧完成。
 *
 * 公式（design，`dtMin = io.dt / 60`，不足一分钟的活动不按 dt 比例截断，与汗液/呼吸失水语义
 * 一致）：
 *   legacy   = 旧档迁移份额（见下；无旧总量时为 undefined，旧总量为 0 时是 0）
 *   uptake   = 轮初 uptakeG（字段缺失按 0）
 *   seeded   = 本轮状态逐字段等于 initialState 默认种子
 *   base     = legacy === undefined ? max(0, glycogenG)
 *            : seeded ? legacy
 *            : max(0, glycogenG) + legacy
 *   active   = physicalActivity 已加载且 remainingExerciseMin > 0
 *   consumed = active
 *     ? min(glycogenUseRateGPerMin × regionShare × intensity × dtMin, base + uptake)
 *     : 0
 *   glycogenG = base + uptake − consumed
 *   write { uptakeG: 0, glycogenG, glycogenConsumedG: consumed }
 * `glycogenUseRateGPerMin`（0.5 g/min）来自同目录上一级的 `glucose-uptake.parameters.json`，
 * 按区域份额（头颈 0.05 / 躯干 0.45 / 四肢 0.50）拆分，三区全负荷合计恰好 0.5 g/min，不新增区域参数。
 * 各区域静息初始糖原按 300 g 总量依份额分配（头颈 15 g / 躯干 135 g / 四肢 150 g）。
 * `glycogenG` 是区域糖原储量，`glycogenConsumedG` 是本轮实际消耗；`uptakeG` 是仅由
 * `transferIn` 增加的到账通量，每轮 write 归 0。
 *
 * 旧档迁移（design）：旧档只有 `muscleGlucose.glycogenG`（总量）时，区域在自己的第一轮读该
 * 总量，并按**已加载区域**的份额重新归一。若本轮状态仍是 `initialState` 补出的默认种子
 * （`uptakeG = 0`、`glycogenG = 300 g × 份额`、`glycogenConsumedG = 0`），迁移份额**取代**
 * 种子而不是叠加，迁移后总量等于旧总量；若区域已有真实存档状态，迁移份额并入其存量。
 * 聚合器第一次 write 不再保留旧总量，后续轮次读不到旧量，不会重复迁移。旧档的在途
 * `uptakeG` 不参与迁移，仍由聚合器按正常路径 transfer，区域下一轮入账。
 * 区域只读 `muscleGlucose.glycogenG` 与兄弟区域是否存在，不写聚合器或兄弟区域；缺失区域
 * 不推断质量（例如只有头和躯干时份额为 0.1/0.9）。
 *
 * 时序（design）：第 N 轮聚合器把上一轮到账量转给区域；第 N+1 轮区域把 `uptakeG` 入账并
 * 消耗。运动动作第 1 轮进入 `physicalActivity`，第 2 轮区域才开始消耗。轮初快照语义与现有
 * 器官一致；方括号内单位：uptakeG/g、glycogenG/g、glycogenConsumedG/g、
 * remainingExerciseMin/min、intensity/1。
 *
 * 证据：本切片没有区域肌糖原储量、区域质量分布、运动底物利用或糖原分解速率的实测数据。
 * `muscleGlucose.glycogenUseRateGPerMin = 0.5` 是 `status: design`、`source: null` 的工程
 * 占位，不是实测值、拟合值或临床阈值，不能称 validated。`SRC-DALLAMAN-2007` 只支撑“组织
 * 利用可分为胰岛素依赖与非依赖项”的结构方向，不支撑区域消耗速率或区域份额。
 *
 * 未建模（design）：区域肌肉绝对质量、区域血流与纤维类型、肌群疲劳/延迟酸痛、左右肢体与
 * 皮肤分区、运动类型/MET/强度非线性、乳酸与 Cori 循环、脂肪组织分区、个体差异。区域之间
 * 不互相搬运糖原；某区域耗尽后不虚构补充，消耗不回流血糖或肝。肌肉无葡萄糖-6-磷酸酶，
 * 不向血液释放葡萄糖。
 *
 * 边界：`physicalActivity` 未加载时消耗 0；已加载但字段缺失、非有限、剩余时间为负或
 * intensity 超出 [0, 1] 时抛错使本轮失败且不写状态，不用健康常量掩盖异常。合法 0 活动、
 * 0 到账与 0 存量都是有效值。
 */
import {
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../../lib/parameters.js';

export type MuscleRegionId = 'muscleHead' | 'muscleTrunk' | 'muscleLimbs';

export type MuscleRegionState = {
  uptakeG: number;
  glycogenG: number;
  glycogenConsumedG: number;
};

type SavedMuscleRegionState = {
  readonly uptakeG?: unknown;
  readonly glycogenG?: unknown;
  readonly glycogenConsumedG?: unknown;
};

type SavedMuscleGlucoseState = {
  readonly glycogenG?: unknown;
};

type ActivityReading = {
  remainingExerciseMin?: unknown;
  intensity?: unknown;
};

type IO = {
  read(partId: MuscleRegionId): Readonly<SavedMuscleRegionState> | undefined;
  read(partId: 'muscleGlucose'): Readonly<SavedMuscleGlucoseState> | undefined;
  read(partId: 'physicalActivity'): Readonly<ActivityReading> | undefined;
  readonly dt: number;
  write(next: MuscleRegionState): void;
};

const regionShares: Readonly<Record<MuscleRegionId, number>> = {
  muscleHead: 0.05,
  muscleTrunk: 0.45,
  muscleLimbs: 0.5,
};

const INITIAL_TOTAL_GLYCOGEN_G = scaleByBodyWeight(300);
const regionIds = Object.keys(regionShares) as MuscleRegionId[];

const parameters = loadParameters(
  new URL('../glucose-uptake.parameters.json', import.meta.url),
);
const glycogenUseRateGPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'muscleGlucose.glycogenUseRateGPerMin'),
  'muscleGlucose.glycogenUseRateGPerMin',
);

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function requireFinite(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`physicalActivity.${name} must be a finite number`);
  }
  return value;
}

function readActivity(
  io: IO,
): { remainingExerciseMin: number; intensity: number } | undefined {
  const activity = io.read('physicalActivity');
  if (activity === undefined) return undefined;
  const remainingExerciseMin = requireFinite(
    activity.remainingExerciseMin,
    'remainingExerciseMin',
  );
  const intensity = requireFinite(activity.intensity, 'intensity');
  if (remainingExerciseMin < 0) {
    throw new Error('physicalActivity.remainingExerciseMin must not be negative');
  }
  if (intensity < 0 || intensity > 1) {
    throw new Error('physicalActivity.intensity must be between 0 and 1');
  }
  return { remainingExerciseMin, intensity };
}

function readLegacyGlycogenShareG(io: IO, id: MuscleRegionId): number | undefined {
  const muscle = io.read('muscleGlucose');
  if (muscle === undefined || muscle.glycogenG === undefined) return undefined;
  const totalG = muscle.glycogenG;
  if (typeof totalG !== 'number' || !Number.isFinite(totalG) || totalG < 0) {
    throw new Error('muscleGlucose.glycogenG must be a finite non-negative number');
  }
  const presentShare = regionIds
    .filter((regionId) => io.read(regionId) !== undefined)
    .reduce((sum, regionId) => sum + regionShares[regionId], 0);
  if (presentShare === 0) return undefined;
  return totalG * regionShares[id] / presentShare;
}

function isSeededDefault(
  prev: Readonly<SavedMuscleRegionState>,
  defaults: MuscleRegionState,
): boolean {
  return finiteOrZero(prev.uptakeG) === defaults.uptakeG
    && finiteOrZero(prev.glycogenG) === defaults.glycogenG
    && finiteOrZero(prev.glycogenConsumedG) === defaults.glycogenConsumedG;
}

export function createMuscleRegion(id: MuscleRegionId) {
  const regionShare = regionShares[id];
  const initialState: MuscleRegionState = {
    uptakeG: 0,
    glycogenG: INITIAL_TOTAL_GLYCOGEN_G * regionShare,
    glycogenConsumedG: 0,
  };
  const fields = {
    uptakeG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['muscleGlucose.uptakeG'],
    },
    glycogenG: { unit: 'g', mode: 'absolute' },
    glycogenConsumedG: { unit: 'g', mode: 'absolute' },
  };
  const actionTypes: string[] = [];

  function heartbeat(io: IO): void {
    const prev = io.read(id) ?? initialState;
    const uptakeG = finiteOrZero(prev.uptakeG);
    const legacyG = readLegacyGlycogenShareG(io, id);
    const stockedG = Math.max(0, finiteOrZero(prev.glycogenG));
    const baseG = legacyG === undefined
      ? stockedG
      : isSeededDefault(prev, initialState)
        ? legacyG
        : stockedG + legacyG;
    const availableG = baseG + uptakeG;
    const activity = readActivity(io);

    const consumedG = activity !== undefined && activity.remainingExerciseMin > 0
      ? Math.min(
          glycogenUseRateGPerMin * regionShare * activity.intensity * (io.dt / 60),
          availableG,
        )
      : 0;

    io.write({
      uptakeG: 0,
      glycogenG: availableG - consumedG,
      glycogenConsumedG: consumedG,
    });
  }

  return { id, actionTypes, initialState, fields, heartbeat };
}
