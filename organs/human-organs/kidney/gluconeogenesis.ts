/*
 * 肾糖异生产糖脚本（部位 `kidneyGluconeogenesis`）；部位 `kidneyGluconeogenesis` 的唯一写者。
 * 肾按平滑比例反调节速率把葡萄糖转入 `glucose.glucoseMassG`，与肝糖原释放并行。本切片不建
 * 糖原或底物池：肾糖异生利用乳酸/氨基酸/甘油等底物，但底物池、摄取与耗尽语义均未建模，因此
 * 只按速率受限的产糖代理实现，没有存量上限。
 *
 * 公式（design，`dtMin = io.dt / 60`）：
 *   deficitMgDl = max(0, baselineMgDl − glucose.concentrationMgDl)
 *   excessMgDl  = max(0, glucose.concentrationMgDl − baselineMgDl)
 *   suppression = 1 / (1 + excessMgDl / 30)
 *   rawRate     = basalOutputRateGPerMin × suppression
 *               + hypoglycemiaOutputGainGPerMinPerMgDl × deficitMgDl
 *               + glucagonOutputGainGPerMin × max(0, pancreasEndocrine.glucagonRelative − 1)
 *   rate        = clamp(rawRate, 0, maxOutputRateGPerMin)
 *   glucoseOutputG = min(rate × dtMin, maxOutputPerRoundG)
 *   write { glucoseOutputG }
 *   transfer kidneyGluconeogenesis.glucoseOutputG → glucose.glucoseMassG: glucoseOutputG（> 0 时）
 * `glucoseOutputG` 是每轮实际转出量，不是请求或瞬时速率；每轮 write 写入本轮产量，随后的
 * transfer 把它全部转入血糖，回合结束时字段为 0、不累积到下轮（无产出时 write 即为 0）。
 * `glucose` 与 `pancreasEndocrine` 都是轮初快照，因此产糖与血糖回升之间有一轮滞后。
 * `baselineMgDl` 只是工程反调节参考，不是实测低血糖阈值；90 mg/dL 基线、glucagonRelative = 1
 * 时输出 0.024 g/min，与肝基础输出 0.096 g/min 合计 0.120 g/min，平衡血糖基础消耗。
 *
 * 参数（同目录 `gluconeogenesis.parameters.json`，均 `status: design`、`source: null`）：
 * `maxOutputRateGPerMin = 0.5`、`maxOutputPerRoundG = 0.6`、`baselineMgDl = 90`、
 * `basalOutputRateGPerMin = 0.024`、`hypoglycemiaOutputGainGPerMinPerMgDl = 0.005`、
 * `glucagonOutputGainGPerMin = 0.05`。数值是工程占位，不是拟合值、实测值或临床阈值，不能称 validated。
 *
 * 边界：`glucose` 未加载时按 `concentrationMgDl = baselineMgDl` 回退（基础产糖，高胰高血糖素
 * 可继续提高产糖）；`pancreasEndocrine` 未加载时按 `glucagonRelative = 1` 回退。
 * 已加载但字段缺失、非有限或为负时抛错使本轮失败，且不写状态、不发起 transfer，不用健康
 * 常量掩盖异常；合法 0 浓度、0 胰高血糖素与 1 的基线信号都是有效读数。本脚本不读
 * `glucose.glucoseMassG`、不读肝状态，也不建 EPO、肾素/RAAS、GFR 或绝对激素浓度。
 */
import {
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

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
const maxOutputRateGPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'kidneyGluconeogenesis.maxOutputRateGPerMin'),
  'kidneyGluconeogenesis.maxOutputRateGPerMin',
);
const maxOutputPerRoundG = scaleByBodyWeight(
  requireParameter(parameters, 'kidneyGluconeogenesis.maxOutputPerRoundG'),
  'kidneyGluconeogenesis.maxOutputPerRoundG',
);
const baselineMgDl = requireParameter(parameters, 'kidneyGluconeogenesis.baselineMgDl');
const basalOutputRateGPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'kidneyGluconeogenesis.basalOutputRateGPerMin'),
  'kidneyGluconeogenesis.basalOutputRateGPerMin',
);
const hypoglycemiaOutputGainGPerMinPerMgDl = scaleByBodyWeight(
  requireParameter(parameters, 'kidneyGluconeogenesis.hypoglycemiaOutputGainGPerMinPerMgDl'),
  'kidneyGluconeogenesis.hypoglycemiaOutputGainGPerMinPerMgDl',
);
const glucagonOutputGainGPerMin = scaleByBodyWeight(
  requireParameter(parameters, 'kidneyGluconeogenesis.glucagonOutputGainGPerMin'),
  'kidneyGluconeogenesis.glucagonOutputGainGPerMin',
);

const SUPPRESSION_SCALE_MG_DL = 30;

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
  const deficitMgDl = Math.max(0, baselineMgDl - concentrationMgDl);
  const excessMgDl = Math.max(0, concentrationMgDl - baselineMgDl);
  const suppression = 1 / (1 + excessMgDl / SUPPRESSION_SCALE_MG_DL);
  const rawRate = basalOutputRateGPerMin * suppression
    + hypoglycemiaOutputGainGPerMinPerMgDl * deficitMgDl
    + glucagonOutputGainGPerMin * Math.max(0, glucagonRelative - 1);
  const rate = Math.min(maxOutputRateGPerMin, Math.max(0, rawRate));
  const glucoseOutputG = Math.min(rate * dtMin, maxOutputPerRoundG);

  io.write({ glucoseOutputG });
  if (glucoseOutputG > 0) {
    io.transfer(id, 'glucoseOutputG', 'glucose', 'glucoseMassG', glucoseOutputG);
  }
}
