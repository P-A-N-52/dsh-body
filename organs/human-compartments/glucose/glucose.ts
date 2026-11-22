/*
 * 葡萄糖表观分布隔室（glucose）；部位 `glucose` 的唯一写者。它是隔室而不是解剖器官，因此放在
 * `organs/human-compartments/glucose/`。
 *
 * 来源（登记见 organs/human-organs/references/source-index.csv）：
 * - SRC-DALLAMAN-2007 / dalla-man-2007：笔记
 *   organs/human-compartments/glucose/references/notes/dalla-man-2007.md，PMID 17926672，
 *   DOI 10.1109/TBME.2007.893506。原文 p.1741 §III.A 与式 (1) 把 `G_p` 定义为血浆和快速平衡
 *   组织中的葡萄糖质量，把 `V_G` 定义为按体重计的葡萄糖分布体积（dL/kg）；p.1743 Table I
 *   的正常组模型常数为 1.88 dL/kg。该常数来自 204 名正常人的三重示踪混合餐均值数据所建平均
 *   模型，不是 204 人的直接实测均值；原文未报告该常数单独的估计/固定方法、精度或个体间离散度，
 *   也未标注 ± 类型，本脚本不猜。p.1748 Discussion 称该模型是 mean model。
 *   p.1745 §III.C.5 式 (27) 的肾糖排泄结构只用于下游 `kidneyGlucose` 请求；本脚本不重复其
 *   滤过参数，只按轮初请求结算实际质量转出。
 *
 * 可及池定义（design）：`glucoseMassG` 是“血浆 + 快速平衡组织”可及池的葡萄糖质量；
 * `apparentDistributionVolumeDl = 75 kg × 1.88 dL/kg = 141 dL` 是按体重归一的表观分布体积，
 * 不是血浆体积、瘦体重归一化、总体水或直接测得的全身葡萄糖。90 mg/dL 基线对应
 * `B = 90 × 141 / 1000 = 12.69 g`，是工程初始量与清除下限，不是实测血浆葡萄糖质量。
 * 本脚本不声称复现原文的两室动力学、胰岛素依赖处置或个体预测。
 *
 * 工程假设（design）：
 * - 固定 75 kg、90 mg/dL 基线与 60 min 表观清除半时都 `source: null`
 *   （同目录 `glucose.parameters.json`）；未来分别由身体预设/个体输入、个体空腹测量和
 *   胰岛素—组织利用模型替换。分布体积参数 `source: SRC-DALLAMAN-2007` 只是定义与量级锚点。
 * - 浓度是本轮轮初质量读数：`concentrationMgDl = M_start × 1000 / V`。小肠同轮 transfer 的
 *   新吸收量在 write 之后才加入 `glucoseMassG`，因此当轮浓度仍读旧质量，下一轮才上升。
 * - 非肾清除只作用于高于基线质量的部分，并按轮初胰腺相对信号 `I` 缩放清除指数：
 *   `D = max(0, M_start − B) × (1 − 2^(−dtMin × I / 60))`。`I = 1` 时与旧 60 min 公式逐位
 *   一致；`I = 0` 时停止超基线清除，低于基线时保持原质量、不虚构肝糖补充。
 *   `disposedGlucoseG` 只是非肾表观清除汇，不区分组织去向，也不含肾糖排泄。
 * - 肾糖按轮初请求 `R` 在非肾清除之后结算：`M_after = M_start − D`，
 *   `E = min(max(0, R), M_after)`；write 出 `M_after` 后再 transfer
 *   `glucoseMassG → kidneyGlucose.excretedGlucoseG`。同轮小肠新流入不能支付本轮请求。
 * - 缺失 `pancreasEndocrine` 时按 `I = 1`；仅直接调用 `heartbeat`/不构建字段注册表时，缺失
 *   `kidneyGlucose` 按请求 0。任何包含 `glucose` 的 Gateway 清单必须同时加载 `kidneyGlucose`，
 *   否则启动配对校验失败。上游部位已加载但字段缺失、非有限或为负数时抛错使本轮失败，
 *   不用健康常量掩盖。合法 0 信号/请求有效。
 * - 旧存档缺 `glucoseMassG` 时按基础质量初始化；负值按 0 读取，不产生负质量或负清除。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'glucose';
export const actionTypes: string[] = [];

type GlucoseState = {
  glucoseMassG: number;
  concentrationMgDl: number;
  disposedGlucoseG: number;
};

type PancreasState = {
  insulinRelative: number;
};

type KidneyGlucoseState = {
  excretionRequestG: number;
};

const parameters = loadParameters(new URL('./glucose.parameters.json', import.meta.url));
const referenceBodyMassKg = requireParameter(parameters, 'glucose.referenceBodyMassKg');
const distributionVolumeDlPerKg = requireParameter(parameters, 'glucose.distributionVolumeDlPerKg');
const baselineConcentrationMgDl = requireParameter(parameters, 'glucose.baselineConcentrationMgDl');
const apparentDisposalHalfTimeMin = requireParameter(
  parameters,
  'glucose.apparentDisposalHalfTimeMin',
);

const distributionVolumeDl = referenceBodyMassKg * distributionVolumeDlPerKg;
const baselineMassG = baselineConcentrationMgDl * distributionVolumeDl / 1000;

export const initialState: GlucoseState = {
  glucoseMassG: baselineMassG,
  concentrationMgDl: baselineConcentrationMgDl,
  disposedGlucoseG: 0,
};

export const fields = {
  glucoseMassG: {
    unit: 'g',
    mode: 'absolute',
    transferIn: ['smallIntestine.carbohydrateG'],
    transferOut: ['kidneyGlucose.excretedGlucoseG'],
  },
  concentrationMgDl: { unit: 'mg/dL', mode: 'absolute' },
  disposedGlucoseG: { unit: 'g', mode: 'absolute' },
};

type IO = {
  read(id: 'glucose'): Readonly<GlucoseState> | undefined;
  read(id: 'pancreasEndocrine'): Readonly<PancreasState> | undefined;
  read(id: 'kidneyGlucose'): Readonly<KidneyGlucoseState> | undefined;
  readonly dt: number;
  write(next: GlucoseState): void;
  transfer(
    fromPart: 'glucose',
    fromField: 'glucoseMassG',
    toPart: 'kidneyGlucose',
    toField: 'excretedGlucoseG',
    amount: number,
  ): void;
};

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function insulinRelativeOf(pancreas: Readonly<PancreasState>): number {
  const insulinRelative = pancreas.insulinRelative;
  if (
    typeof insulinRelative !== 'number'
    || !Number.isFinite(insulinRelative)
    || insulinRelative < 0
  ) {
    throw new Error(
      'glucose: pancreasEndocrine.insulinRelative must be a finite non-negative number',
    );
  }
  return insulinRelative;
}

function excretionRequestOf(kidney: Readonly<KidneyGlucoseState>): number {
  const excretionRequestG = kidney.excretionRequestG;
  if (
    typeof excretionRequestG !== 'number'
    || !Number.isFinite(excretionRequestG)
    || excretionRequestG < 0
  ) {
    throw new Error(
      'glucose: kidneyGlucose.excretionRequestG must be a finite non-negative number',
    );
  }
  return excretionRequestG;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const startMassG = Math.max(0, finiteOrZero(prev.glucoseMassG));
  const concentrationMgDl = startMassG * 1000 / distributionVolumeDl;
  const excessG = Math.max(0, startMassG - baselineMassG);
  const dtMin = io.dt / 60;

  const pancreas = io.read('pancreasEndocrine');
  const insulinRelative = pancreas === undefined ? 1 : insulinRelativeOf(pancreas);
  const disposedGlucoseG = excessG
    * (1 - 2 ** (-dtMin * insulinRelative / apparentDisposalHalfTimeMin));
  const afterDisposalG = startMassG - disposedGlucoseG;

  const kidney = io.read('kidneyGlucose');
  const requestG = kidney === undefined ? 0 : excretionRequestOf(kidney);
  const renalExcretionG = Math.min(Math.max(0, requestG), afterDisposalG);

  io.write({
    glucoseMassG: afterDisposalG,
    concentrationMgDl,
    disposedGlucoseG,
  });
  if (kidney !== undefined && renalExcretionG > 0) {
    io.transfer(id, 'glucoseMassG', 'kidneyGlucose', 'excretedGlucoseG', renalExcretionG);
  }
}
