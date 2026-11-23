/*
 * 结肠（colon）薄切片：接收小肠转入的残渣水，按工程速率回收水分回流 `bodyFluid`，
 * 同时形成粪便储存、响应 `defecate` 动作排出，并输出便意代理。部位 `colon` 的唯一写者。
 *
 * 证据：无直接人体测量。`colon.reclamationRatePerMin = 0.001 /min`、
 * `colon.stoolFormationGPerMin = 0.01 g/min`、`colon.referenceStoolG = 200 g`（同目录
 * `colon.parameters.json`）全部是 `design`、`source: null` 的工程假设，不是结肠转运时间、
 * 结肠吸水率、粪便形成率或便意阈值的人体测量，也不是对任何研究的拟合。设计背景见
 * docs/superpowers/specs/2026-11-24-bowel-design.md；本切片不新增论文证据，不把 200 g 或
 * 0.001 /min 称为生理正常值。实际结肠转运约以小时计，本切片用 60 s 轮上的固定比例代理，
 * 不建分段转运或昼夜节律。
 *
 * 公式（dtMin = io.dt / 60；只读轮初快照与本轮原始动作）：
 *   startResidue = max(0, prev.residueWaterMl)
 *   reclaimed = min(startResidue × reclamationRatePerMin × dtMin, startResidue)
 *   startStoolG = max(0, prev.stoolG)
 *   本轮有 `defecate`：defecatedG = startStoolG；stoolG = 0
 *   否则：defecatedG = 0；stoolG = startStoolG + stoolFormationGPerMin × dtMin
 *   bowelUrgencyMm = clamp(100 × stoolG / referenceStoolG, 0, 100)
 *   transfer colon.reclaimedWaterMl → bodyFluid.waterVolumeMl: reclaimed
 *
 * 转移与写入（design）：
 * - `residueWaterMl` 是结肠残渣水池，唯一上游是 `smallIntestine.waterVolumeMl`（由清单
 *   `transferIn`/`transferOut` 配对）。本模块不自行生成残渣、不读小肠状态，也不把饮水或
 *   食糜体积反推成残渣水。
 * - `reclaimedWaterMl` 是本轮回收水的暂存字段：`write` 先写入本轮回收量，随后 Gateway
 *   在 transfer 阶段把它转给 `bodyFluid.waterVolumeMl`，提交后该字段回到 0。`residueWaterMl`
 *   在 `write` 中已扣除 reclaimed，因此回收不是凭空的第二份水；同轮小肠转入在 transfer
 *   阶段才加到 `residueWaterMl`，不会参与本轮回收（写先于转移）。方向是回流，不是体液支出。
 * - 回收量按轮初残渣计算，且不超过轮初残渣；残渣、粪便的负值或非有限自身历史字段按 0 读取，
 *   不抛错。`reclaimedWaterMl` 的写入值、`stoolG`、`defecatedG` 与便意都是有限数，状态
 *   JSON-safe；残渣/粪便极大时只做有限钳位，不写出 Infinity。
 * - `defecate` 与 `urinate` 同类，是允许会话主动触发的输出动作；同轮多个 `defecate` 只结算
 *   一次。本轮排出的只是轮初粪便，`defecatedG` 是每轮通量而不是累计量；排便轮不再累加本轮
 *   粪便形成，`stoolG` 与便意都归零。空结肠上的 `defecate` 仍是合法动作，只是排出 0，不保证
 *   领域值改变。不建直肠储袋，因此不区分“结肠储存”与“直肠待排”。
 * - 上游契约：`bodyFluid` 是本模块的转移目标。直接调用时若 `bodyFluid` 缺失（undefined/null）
 *   不校验；已加载但不是对象、或 `waterVolumeMl` 缺失、非有限、为负时抛错，且在 `write` 与
 *   transfer 之前抛错，本轮不留下部分状态。清单中缺 `bodyFluid` 或配对字段会在启动校验时报错。
 *
 * 消费者与未建模：`bowelUrgencyMm` 只是本部位的 0–100 mm 便意代理读数（100 × 粪便量 /
 * 200 g，超过 200 g 封顶），不是直肠压力、肛门直肠测压阈值或临床便意评分；本切片未接入
 * `interoception` 或 `brainNotify`，不产生通知，也没有自动排便反射。不建结肠菌群、发酵、
 * 气体/腹胀、消化酶、纤维、Bristol 分型、便秘/腹泻、直肠肛门括约肌、粪便水/能量账本或
 * 结肠分段转运；粪便质量只按固定速率增长，不由摄入成分反推。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'colon';
export const actionTypes: string[] = ['defecate'];

type ColonState = {
  residueWaterMl: number;
  stoolG: number;
  defecatedG: number;
  reclaimedWaterMl: number;
  bowelUrgencyMm: number;
};

export const initialState: ColonState = {
  residueWaterMl: 0,
  stoolG: 0,
  defecatedG: 0,
  reclaimedWaterMl: 0,
  bowelUrgencyMm: 0,
};

export const fields = {
  residueWaterMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['smallIntestine.waterVolumeMl'],
  },
  stoolG: { unit: 'g', mode: 'absolute' },
  defecatedG: { unit: 'g', mode: 'absolute' },
  reclaimedWaterMl: {
    unit: 'mL',
    mode: 'absolute',
    transferOut: ['bodyFluid.waterVolumeMl'],
  },
  bowelUrgencyMm: { unit: 'mm', mode: 'absolute' },
};

type Action = {
  readonly type?: unknown;
};

type BodyFluidReading = {
  readonly waterVolumeMl?: unknown;
};

type IO = {
  read(id: 'colon'): Readonly<ColonState> | undefined;
  read(id: 'bodyFluid'): Readonly<BodyFluidReading> | null | undefined;
  readonly actions: readonly (Action | null | undefined)[];
  readonly dt: number;
  write(next: ColonState): void;
  transfer(
    fromPart: 'colon',
    fromField: 'reclaimedWaterMl',
    toPart: 'bodyFluid',
    toField: 'waterVolumeMl',
    amount: number,
  ): void;
};

const parameters = loadParameters(new URL('./colon.parameters.json', import.meta.url));
const reclamationRatePerMin = requireParameter(parameters, 'colon.reclamationRatePerMin');
const stoolFormationGPerMin = requireParameter(parameters, 'colon.stoolFormationGPerMin');
const referenceStoolG = requireParameter(parameters, 'colon.referenceStoolG');

const MIN_MM = 0;
const MAX_MM = 100;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function assertBodyFluidTarget(io: IO): void {
  const bodyFluid = io.read('bodyFluid');
  if (bodyFluid === undefined || bodyFluid === null) return;
  if (typeof bodyFluid !== 'object') throw new Error('bodyFluid must be an object');
  const waterVolumeMl = bodyFluid.waterVolumeMl;
  if (typeof waterVolumeMl !== 'number' || !Number.isFinite(waterVolumeMl) || waterVolumeMl < 0) {
    throw new Error('bodyFluid.waterVolumeMl must be a finite non-negative number');
  }
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  assertBodyFluidTarget(io);

  const dtMin = io.dt / 60;
  const startResidueMl = Math.max(0, finiteOrZero(prev.residueWaterMl));
  const startStoolG = Math.max(0, finiteOrZero(prev.stoolG));
  const reclaimedWaterMl = Math.min(
    startResidueMl * reclamationRatePerMin * dtMin,
    startResidueMl,
  );
  const defecate = io.actions.some((action) => action?.type === 'defecate');
  const defecatedG = defecate ? startStoolG : 0;
  const stoolG = defecate ? 0 : startStoolG + stoolFormationGPerMin * dtMin;
  const bowelUrgencyMm = clamp(100 * (stoolG / referenceStoolG), MIN_MM, MAX_MM);

  io.write({
    residueWaterMl: Math.max(0, startResidueMl - reclaimedWaterMl),
    stoolG,
    defecatedG,
    reclaimedWaterMl,
    bowelUrgencyMm,
  });
  io.transfer(id, 'reclaimedWaterMl', 'bodyFluid', 'waterVolumeMl', reclaimedWaterMl);
}
