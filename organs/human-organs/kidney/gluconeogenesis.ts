/*
 * 肾糖异生产糖脚本（部位 `kidneyGluconeogenesis`）；部位 `kidneyGluconeogenesis` 的唯一写者。
 * 低血糖或胰高血糖素高于基线时，肾按自身速率把葡萄糖转入 `glucose.glucoseMassG`，与肝糖原
 * 释放并行、各自独立受各自阈值驱动。本切片不建糖原或底物池：肾糖异生利用乳酸/氨基酸/甘油等
 * 底物，但底物池、摄取与耗尽语义均未建模，因此只按速率受限的产糖代理实现，没有存量上限。
 *
 * 公式（design，`dtMin = io.dt / 60`）：
 *   active = glucose.concentrationMgDl < baselineMgDl || pancreasEndocrine.glucagonRelative > 1
 *   glucoseOutputG = active
 *     ? min(maxOutputRateGPerMin × glucagonRelative × dtMin, maxOutputPerRoundG)
 *     : 0
 *   write { glucoseOutputG }
 *   transfer kidneyGluconeogenesis.glucoseOutputG → glucose.glucoseMassG: glucoseOutputG（> 0 时）
 * `glucoseOutputG` 是每轮实际转出量，不是请求或瞬时速率；每轮 write 写入本轮产量，随后的
 * transfer 把它全部转入血糖，回合结束时字段为 0、不累积到下轮（无产出时 write 即为 0）。
 * `glucose` 与 `pancreasEndocrine` 都是轮初快照，因此产糖与
 * 血糖回升之间有一轮滞后。`baselineMgDl` 只是工程触发参考，不是实测低血糖阈值；肾糖异生
 * 对胰高血糖素的剂量反应、长期空腹贡献比例和个体差异都未建模。
 *
 * 参数（同目录 `gluconeogenesis.parameters.json`，均 `status: design`、`source: null`）：
 * `maxOutputRateGPerMin = 0.3`、`maxOutputPerRoundG = 0.3`、`baselineMgDl = 90`。数值是工程
 * 占位，不是拟合值、实测值或临床阈值，不能称 validated。
 *
 * 边界：`glucose` 未加载时按 `concentrationMgDl = baselineMgDl` 回退（基线不产糖，但高
 * 胰高血糖素仍可驱动产糖）；`pancreasEndocrine` 未加载时按 `glucagonRelative = 1` 回退。
 * 已加载但字段缺失、非有限或为负时抛错使本轮失败，且不写状态、不发起 transfer，不用健康
 * 常量掩盖异常；合法 0 浓度、0 胰高血糖素与 1 的基线信号都是有效读数。本脚本不读
 * `glucose.glucoseMassG`、不读肝状态，也不建 EPO、肾素/RAAS、GFR 或绝对激素浓度。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'kidneyGluconeogenesis';
export const actionTypes: string[] = [];

type KidneyGluconeogenesisState = {
  glucoseOutputG: number;
};

type GlucoseReading = {
  concentrationMgDl?: unknown;
};

type PancreasReading = {
  glucagonRelative?: unknown;
};

const parameters = loadParameters(new URL('./gluconeogenesis.parameters.json', import.meta.url));
const maxOutputRateGPerMin = requireParameter(
  parameters,
  'kidneyGluconeogenesis.maxOutputRateGPerMin',
);
const maxOutputPerRoundG = requireParameter(
  parameters,
  'kidneyGluconeogenesis.maxOutputPerRoundG',
);
const baselineMgDl = requireParameter(parameters, 'kidneyGluconeogenesis.baselineMgDl');

export const initialState: KidneyGluconeogenesisState = {
  glucoseOutputG: 0,
};

export const fields = {
  glucoseOutputG: {
    unit: 'g',
    mode: 'absolute',
    transferOut: ['glucose.glucoseMassG'],
  },
};

type IO = {
  read(id: 'glucose'): Readonly<GlucoseReading> | undefined;
  read(id: 'pancreasEndocrine'): Readonly<PancreasReading> | undefined;
  readonly dt: number;
  write(next: KidneyGluconeogenesisState): void;
  transfer(
    fromPart: 'kidneyGluconeogenesis',
    fromField: 'glucoseOutputG',
    toPart: 'glucose',
    toField: 'glucoseMassG',
    amount: number,
  ): void;
};

function concentrationOf(glucose: Readonly<GlucoseReading>): number {
  const concentrationMgDl = glucose.concentrationMgDl;
  if (
    typeof concentrationMgDl !== 'number'
    || !Number.isFinite(concentrationMgDl)
    || concentrationMgDl < 0
  ) {
    throw new Error(
      'kidneyGluconeogenesis: glucose.concentrationMgDl must be a finite non-negative number',
    );
  }
  return concentrationMgDl;
}

function glucagonRelativeOf(pancreas: Readonly<PancreasReading>): number {
  const glucagonRelative = pancreas.glucagonRelative;
  if (
    typeof glucagonRelative !== 'number'
    || !Number.isFinite(glucagonRelative)
    || glucagonRelative < 0
  ) {
    throw new Error(
      'kidneyGluconeogenesis: pancreasEndocrine.glucagonRelative must be a finite non-negative number',
    );
  }
  return glucagonRelative;
}

export function heartbeat(io: IO): void {
  const glucose = io.read('glucose');
  const concentrationMgDl = glucose === undefined ? baselineMgDl : concentrationOf(glucose);
  const pancreas = io.read('pancreasEndocrine');
  const glucagonRelative = pancreas === undefined ? 1 : glucagonRelativeOf(pancreas);

  const dtMin = io.dt / 60;
  const active = concentrationMgDl < baselineMgDl || glucagonRelative > 1;
  const glucoseOutputG = active
    ? Math.min(maxOutputRateGPerMin * glucagonRelative * dtMin, maxOutputPerRoundG)
    : 0;

  io.write({ glucoseOutputG });
  if (glucoseOutputG > 0) {
    io.transfer(id, 'glucoseOutputG', 'glucose', 'glucoseMassG', glucoseOutputG);
  }
}
