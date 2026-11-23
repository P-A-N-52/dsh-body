/*
 * 葡萄糖表观分布隔室（glucose）结算核心；部位 `glucose` 的唯一写者。它是隔室而不是解剖器官，
 * 因此放在 `organs/human-compartments/glucose/`。
 *
 * 正常入口 `glucose.ts` 结算“肾 → 肝 → 肌”三汇；女性变体 `glucose.female.ts` 在末位追加
 * `mammaryGlands.lactoseG`（乳汁乳糖），只用于 `body-modules.female.json`。两个入口共用本核心
 * 与 `glucose.parameters.json`，同一清单不能同时加载；根清单不因乳糖汇被强制要求乳腺部位。
 * 女性变体的乳糖汇见 docs/superpowers/specs/2026-11-24-mammary-glands-design.md。
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
 * - 固定 75 kg、90 mg/dL 基线与 60 min 残余清除半时都 `source: null`
 *   （同目录 `glucose.parameters.json`）。`residualDisposalHalfTimeMin` 只描述本隔室自身
 *   （脑/红细胞等非器官组织）的表观清除，与 `pancreasEndocrine.insulinRelative` 无关；
 *   它不是组织摄糖效率或总清除半时。未来分别由身体预设/个体输入、个体空腹测量和更完整的
 *   非器官组织清除模型替换。分布体积参数 `source: SRC-DALLAMAN-2007` 只是定义与量级锚点。
 * - 浓度是本轮轮初质量读数：`concentrationMgDl = M_start × 1000 / V`。小肠同轮 transfer 的
 *   新吸收量在 write 之后才加入 `glucoseMassG`，因此当轮浓度仍读旧质量，下一轮才上升。
 * - 本核心只持血池、计算自身残余清除，并按入口给出的汇顺序结算各部位上一轮写出的摄糖请求：
 *   1. `E = max(0, M_start − B)` 写成只读字段 `excessMassG`，唯一写者为本部位；肌肉与肝
 *      读取它计算自己的请求，本脚本不反向读取它们的容量或参数。
 *   2. `D = E × (1 − 2^(−dtMin / residualDisposalHalfTimeMin))` 是本轮自身残余清除，写入
 *      `disposedGlucoseG`；低于基线时 `E = 0`、`D = 0`，不产生清除。
 *   3. 轮初请求按入口给出的顺序读取并结算（顺序是 `policy`，不是人体优先级证据）：
 *      正常入口为 `R = kidneyGlucose.excretionRequestG`（缺部位按 0）、
 *      `L_req = liver.storageRequestG`、`U_req = muscleGlucose.uptakeRequestG`；
 *      女性变体在末位追加 `G_req = mammaryGlands.lactoseRequestG`（缺部位按 0）。
 *      设 `M_after = M_start − D`，每个汇 `paid = min(request, 剩余余额)`，前序汇先拿，
 *      后序汇被剩余余额钳位，池不会被透支：
 *      肾 → 肝 → 肌 → [乳腺]。`liver` 与 `muscleGlucose` 是必需汇，缺部位时 `heartbeat`
 *      抛错；`kidneyGlucose` 与 `mammaryGlands` 是可选汇，缺部位按 0。
 *   4. write 值为转移前质量 `W = M_after`；钳位保证各笔 paid 之和 ≤ W，Gateway 随后从
 *      `glucoseMassG` 逐笔扣除，最终 `M_final = W − Σ paid`。这里不再把 paid 加回 write 值：
 *      `M_after` 只扣自身残余清除，加回会与转移重复计入并凭空产生质量。质量账：
 *      `M_start = M_final + (D + Σ paid)`。`D` 是自身残余清除，各 paid 分别是肾糖、肝储存、
 *      肌摄糖与乳汁乳糖的实际到账；请求字段不是通量。请求与释放都用轮初快照，因此结算滞后一轮。
 *      正常入口的 Gateway 按 transfer 对键排序实际扣减为肾 → 肝 → 肌；女性变体为
 *      肾 → 肝 → 乳腺 → 肌，但每笔金额已按上述顺序钳位且总额不超过 W，扣减顺序不影响金额
 *      或质量守恒。
 *   5. 本核心不读 `pancreasEndocrine`、不读肝容量或存量，也不拆分份额；组织效率由各部位
 *      按自己的参数决定，总清除量是各部位响应的涌现结果，不再承诺与旧的固定份额轨迹逐位一致。
 * - 已加载汇但请求字段缺失、非有限或为负时抛错使本轮失败，且不写状态、不发起 transfer。
 *   合法 0 请求有效（例如肝满或低血糖），不是缺失。
 * - 低于基线时本核心不自行生成质量：`liver` 按胰高血糖素信号发起
 *   `liver.glycogenG → glucose.glucoseMassG`，经本字段的 transferIn 入账；释放量受肝糖原
 *   存量限制，存量耗尽时血糖照常下降，浓度在下一轮体现。同轮小肠新流入不能支付本轮请求。
 * - 旧存档缺 `excessMassG` 时由轮初质量现算（每轮 write 都重算，不读旧值）；缺
 *   `glucoseMassG` 时按基础质量初始化；负值按 0 读取，不产生负质量或负清除。
 *
 * 入口契约：本核心不导出 `id` / `actionTypes` / `initialState` 值；`createGlucose(sinks)` 接受
 * 按结算顺序排列的汇配置（请求部位/字段、transfer 目标、是否必需），返回该入口的
 * `initialState`、`fields` 与 `heartbeat`。`glucoseMassG.transferOut` 由汇配置生成，因此根清单
 * 只声明三汇，女性变体末位多一条 `mammaryGlands.lactoseG`。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export type GlucoseState = {
  glucoseMassG: number;
  concentrationMgDl: number;
  disposedGlucoseG: number;
  excessMassG: number;
};

export type GlucoseSink = {
  requestPart: string;
  requestField: string;
  toPart: string;
  toField: string;
  required: boolean;
};

export type GlucoseIO = {
  read(partId: string): Readonly<Record<string, unknown>> | undefined;
  readonly dt: number;
  write(next: GlucoseState): void;
  transfer(
    fromPart: 'glucose',
    fromField: 'glucoseMassG',
    toPart: string,
    toField: string,
    amount: number,
  ): void;
};

export type GlucoseFields = {
  glucoseMassG: {
    unit: string;
    mode: string;
    transferIn: string[];
    transferOut: string[];
  };
  concentrationMgDl: { unit: string; mode: string };
  disposedGlucoseG: { unit: string; mode: string };
  excessMassG: { unit: string; mode: string };
};

export type GlucoseModule = {
  initialState: GlucoseState;
  fields: GlucoseFields;
  heartbeat(io: GlucoseIO): void;
};

const parameters = loadParameters(new URL('./glucose.parameters.json', import.meta.url));
const referenceBodyMassKg = requireParameter(parameters, 'glucose.referenceBodyMassKg');
const distributionVolumeDlPerKg = requireParameter(parameters, 'glucose.distributionVolumeDlPerKg');
const baselineConcentrationMgDl = requireParameter(parameters, 'glucose.baselineConcentrationMgDl');
const residualDisposalHalfTimeMin = requireParameter(
  parameters,
  'glucose.residualDisposalHalfTimeMin',
);

const distributionVolumeDl = referenceBodyMassKg * distributionVolumeDlPerKg;
const baselineMassG = baselineConcentrationMgDl * distributionVolumeDl / 1000;

const glucoseInitialState: GlucoseState = {
  glucoseMassG: baselineMassG,
  concentrationMgDl: baselineConcentrationMgDl,
  disposedGlucoseG: 0,
  excessMassG: 0,
};

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function requestOf(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`glucose: ${name} must be a finite non-negative number`);
  }
  return value;
}

export function createGlucose(sinks: readonly GlucoseSink[]): GlucoseModule {
  const fields: GlucoseFields = {
    glucoseMassG: {
      unit: 'g',
      mode: 'absolute',
      transferIn: ['smallIntestine.carbohydrateG', 'liver.glycogenG'],
      transferOut: sinks.map((sink) => `${sink.toPart}.${sink.toField}`),
    },
    concentrationMgDl: { unit: 'mg/dL', mode: 'absolute' },
    disposedGlucoseG: { unit: 'g', mode: 'absolute' },
    excessMassG: { unit: 'g', mode: 'absolute' },
  };

  function heartbeat(io: GlucoseIO): void {
    const prev = io.read('glucose') ?? glucoseInitialState;
    const startMassG = Math.max(0, finiteOrZero(prev.glucoseMassG));
    const concentrationMgDl = startMassG * 1000 / distributionVolumeDl;
    const excessMassG = Math.max(0, startMassG - baselineMassG);
    const dtMin = io.dt / 60;

    const requestsG = sinks.map((sink) => {
      const part = io.read(sink.requestPart);
      if (part === undefined) {
        if (sink.required) {
          throw new Error(
            `glucose: ${sink.requestPart} part is required to settle ${sink.requestField} requests`,
          );
        }
        return 0;
      }
      return requestOf(part[sink.requestField], `${sink.requestPart}.${sink.requestField}`);
    });

    const disposedGlucoseG = excessMassG
      * (1 - 2 ** (-dtMin / residualDisposalHalfTimeMin));
    const afterResidualG = startMassG - disposedGlucoseG;
    let remainingG = afterResidualG;
    const amountsG = requestsG.map((requestG) => {
      const amountG = Math.min(requestG, remainingG);
      remainingG = Math.max(0, remainingG - amountG);
      return amountG;
    });

    io.write({
      glucoseMassG: afterResidualG,
      concentrationMgDl,
      disposedGlucoseG,
      excessMassG,
    });
    for (let index = 0; index < sinks.length; index++) {
      const sink = sinks[index];
      if (amountsG[index] > 0) {
        io.transfer('glucose', 'glucoseMassG', sink.toPart, sink.toField, amountsG[index]);
      }
    }
  }

  return { initialState: glucoseInitialState, fields, heartbeat };
}
