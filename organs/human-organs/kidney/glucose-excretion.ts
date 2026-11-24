/*
 * 肾糖质量排泄请求与结算（kidneyGlucose）：部位 `kidneyGlucose` 的唯一写者。
 * 按本轮轮初的 `glucose.concentrationMgDl` 计算下一轮请求，`excretedGlucoseG` 每轮先归 0，
 * 只有 `glucose.glucoseMassG → kidneyGlucose.excretedGlucoseG` 的实际 transfer 才写入质量。
 *
 * 来源（登记见 organs/human-organs/references/source-index.csv）：
 * - SRC-DALLAMAN-2007 / dalla-man-2007：笔记
 *   organs/human-compartments/glucose/references/notes/dalla-man-2007.md §8.3，PMID 17926672，
 *   DOI 10.1109/TBME.2007.893506。p.1745 §III.C.5 式 (27)：`E = k_e1 × (G_p − k_e2)` 仅在
 *   `G_p > k_e2` 时成立，`E` 为 mg/kg/min、`G_p` 为 mg/kg；p.1743 Table I 正常组平均模型常数
 *   `k_e1 = 0.0005 min^-1`、`k_e2 = 339 mg/kg`；p.1742 说明正常基础状态肾糖排泄为 0。
 *   正文把 `k_e1` 称为 glomerular filtration rate，但单位是 min^-1，不是 mL/min 的实测 GFR。
 *   原文未报告这两个常数的单独精度、± 类型或个体间离散度；它们只是已发表平均模型的锚点，
 *   不是本项目拟合、独立验证或人体测量。
 *
 * 取值（参数见同目录 `glucose-excretion.parameters.json`）：
 *   Gp = C × 1.88 mg/kg
 *   E  = max(0, Gp − 339) × 0.0005 mg/kg/min
 *   excretionRequestG = E × 75 kg × dtMin / 1000
 * 其中 1.88 dL/kg 与 75 kg 是 `design` 的可及池/参考体重重复配置；两个 prior 参数只作平均
 * 模型锚点，未来分别由个体肾糖滤过—重吸收和个体肾阈替换。
 *
 * 边界：`excretionRequestG` 是下一轮待转出质量，不是瞬时 mg/min，也不是已排泄量；
 * 本脚本不调用 transfer，不计算尿量 mL、尿糖浓度、尿渗透压或渗透性利尿，不建 GFR mL/min、
 * 肾小管转运体或 SGLT，不读取或改变 `kidney` 水请求、`bodyFluid`、`bladder`、口渴或尿意。
 * 上游 `glucose` 未加载时请求按 0（纯模块行为）；上游已加载但浓度字段缺失、非有限或为负数时
 * 令本轮失败，不用健康常量掩盖；合法 0 请求表示无排泄，不是异常。
 */
import {
  loadParameters,
  requireParameter,
  scaleByBodyWeight,
} from '../../../lib/parameters.js';

export const id = 'kidneyGlucose';
export const actionTypes: string[] = [];

type KidneyGlucoseState = {
  excretionRequestG: number;
  excretedGlucoseG: number;
};

type GlucoseReading = {
  concentrationMgDl?: number;
};

const parameters = loadParameters(new URL('./glucose-excretion.parameters.json', import.meta.url));
const filtrationRatePerMin = requireParameter(parameters, 'kidneyGlucose.filtrationRatePerMin');
const renalThresholdMgKg = requireParameter(parameters, 'kidneyGlucose.renalThresholdMgKg');
const distributionVolumeDlPerKg = requireParameter(
  parameters,
  'kidneyGlucose.distributionVolumeDlPerKg',
);
const referenceBodyMassKg = scaleByBodyWeight(
  requireParameter(parameters, 'kidneyGlucose.referenceBodyMassKg'),
  'kidneyGlucose.referenceBodyMassKg',
);

export const initialState: KidneyGlucoseState = {
  excretionRequestG: 0,
  excretedGlucoseG: 0,
};

export const fields = {
  excretionRequestG: { unit: 'g', mode: 'absolute' },
  excretedGlucoseG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['glucose.glucoseMassG'],
  },
};

type IO = {
  read(id: 'glucose'): Readonly<GlucoseReading> | undefined;
  readonly dt: number;
  write(next: KidneyGlucoseState): void;
};

function concentrationOf(glucose: Readonly<GlucoseReading>): number {
  const concentrationMgDl = glucose.concentrationMgDl;
  if (
    typeof concentrationMgDl !== 'number'
    || !Number.isFinite(concentrationMgDl)
    || concentrationMgDl < 0
  ) {
    throw new Error(
      'kidneyGlucose: glucose.concentrationMgDl must be a finite non-negative number',
    );
  }
  return concentrationMgDl;
}

export function heartbeat(io: IO): void {
  const glucose = io.read('glucose');
  let excretionRequestG = 0;

  if (glucose !== undefined) {
    const concentrationMgDl = concentrationOf(glucose);
    const plasmaGlucoseMassMgKg = concentrationMgDl * distributionVolumeDlPerKg;
    const excretionMgKgMin = Math.max(0, plasmaGlucoseMassMgKg - renalThresholdMgKg)
      * filtrationRatePerMin;
    const dtMin = io.dt / 60;
    excretionRequestG = excretionMgKgMin * referenceBodyMassKg * dtMin / 1000;
  }

  io.write({
    excretionRequestG,
    excretedGlucoseG: 0,
  });
}
