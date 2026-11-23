/*
 * 胰腺内分泌相对胰岛素/胰高血糖素信号脚本；部位 `pancreasEndocrine` 的唯一写者。
 *
 * 证据：
 * - SRC-DALLAMAN-2007 / dalla-man-2007（PMID 17926672，DOI 10.1109/TBME.2007.893506）：
 *   笔记 organs/human-compartments/glucose/references/notes/dalla-man-2007.md。原文只作结构背景：
 *   p.1742 §III.B 与式 (3) 描述胰岛素的血浆/肝两室动力学，p.1744 §III.C.4 与式 (26) 描述
 *   葡萄糖水平与变化率驱动的分泌，p.1744–1745 §III.C.3 描述胰岛素依赖与非依赖的组织利用，
 *   p.1748 Discussion 说明该模型是平均模型。这些只支撑“血糖驱动胰岛素信号、信号再影响葡萄糖
 *   利用”的方向，不支撑本脚本的方程、参数或数值。
 *
 * 信号定义（design）：
 * - `insulinRelative` 是无量纲相对信号，`1` 表示基线；它不是 µU/mL、pmol/L、分泌率、血浆
 *   胰岛素浓度或 C-peptide，也不能与实测值换算。消费者是 `glucose`（缩放超基线处置）。
 * - 目标 `target = clamp(1 + 0.02 × (G − 90), 0, 5)`，再按 10 min 半时一阶趋近：
 *   `I_next = target + (I − target) × 2^(−dtMin / 10)`，`dtMin = io.dt / 60`。`G = 90` 且
 *   `I = 1` 时精确保持 1；低糖可把目标压到 0，高糖最高到 5。
 * - `glucagonRelative` 同样是无量纲相对信号，`1` 表示基线；消费者是 `liver`（按它放大肝糖原
 *   释放），不是 µU/mL、pmol/L、分泌率、血浆胰高血糖素浓度，也不能与实测值换算。目标方向与
 *   胰岛素相反：`target = clamp(1 + 0.02 × (90 − G), 0, 5)`，再按 10 min 半时一阶趋近。
 *   G 高于 90 时目标低于 1，低血糖时升高；上限 5、下限 0。
 * - 0.02 增益、10 min 半时、90 mg/dL 参考值、5 倍上限全部是工程假设（同目录
 *   `insulin.parameters.json` 的 `pancreasEndocrine.insulin.*` 与 `pancreasEndocrine.glucagon.*`，
 *   `status: design`、`source: null`），不是原文方程、文献报告值、拟合结果或个体预测。原文的
 *   两室动力学、饱和作用与胰岛素非依赖利用未复现；原文也不含胰高血糖素，反向曲线纯属工程假设，
 *   不代表 α 细胞分泌、肝糖原分解或两者相互作用的实测动力学。
 * - 只读轮初快照：胰腺不写葡萄糖，无 transfer、动作或通知；葡萄糖和肝是否使用这些信号由各自
 *   模块决定。缺失 `glucose` 部位时按参考值 90 mg/dL 回退，保持清单可替换性。
 * - 已加载的 `glucose` 部位若缺 `concentrationMgDl`、读数非有限或为负，则抛错让本轮失败，
 *   不用健康常量掩盖异常；合法 0 是有效低血糖读数，不当作缺失。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'pancreasEndocrine';
export const actionTypes: string[] = [];

type PancreasState = {
  insulinRelative: number;
  glucagonRelative: number;
};

type GlucoseState = {
  concentrationMgDl: number;
};

export const initialState: PancreasState = {
  insulinRelative: 1,
  glucagonRelative: 1,
};

export const fields = {
  insulinRelative: { unit: '1', mode: 'absolute' },
  glucagonRelative: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(id: 'pancreasEndocrine'): Readonly<PancreasState> | undefined;
  read(id: 'glucose'): Readonly<GlucoseState> | undefined;
  readonly dt: number;
  write(next: PancreasState): void;
};

const parameters = loadParameters(new URL('./insulin.parameters.json', import.meta.url));
const referenceGlucoseMgDl = requireParameter(
  parameters,
  'pancreasEndocrine.referenceGlucoseMgDl',
);
const glucoseGainPerMgDl = requireParameter(
  parameters,
  'pancreasEndocrine.insulin.glucoseGainPerMgDl',
);
const responseHalfTimeMin = requireParameter(
  parameters,
  'pancreasEndocrine.insulin.responseHalfTimeMin',
);
const maxRelative = requireParameter(parameters, 'pancreasEndocrine.insulin.maxRelative');
const glucagonGainPerMgDl = requireParameter(
  parameters,
  'pancreasEndocrine.glucagon.glucoseGainPerMgDl',
);
const glucagonHalfTimeMin = requireParameter(
  parameters,
  'pancreasEndocrine.glucagon.responseHalfTimeMin',
);
const glucagonMaxRelative = requireParameter(
  parameters,
  'pancreasEndocrine.glucagon.maxRelative',
);

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const glucose = io.read('glucose');

  let glucoseMgDl = referenceGlucoseMgDl;
  if (glucose !== undefined) {
    const reading = glucose.concentrationMgDl;
    if (typeof reading !== 'number' || !Number.isFinite(reading) || reading < 0) {
      throw new Error(`pancreasEndocrine: invalid glucose.concentrationMgDl: ${String(reading)}`);
    }
    glucoseMgDl = reading;
  }

  const target = Math.min(
    maxRelative,
    Math.max(0, 1 + glucoseGainPerMgDl * (glucoseMgDl - referenceGlucoseMgDl)),
  );
  const dtMin = io.dt / 60;
  const retention = 2 ** (-dtMin / responseHalfTimeMin);
  const insulinRelative = target + (prev.insulinRelative - target) * retention;

  const glucagonTarget = Math.min(
    glucagonMaxRelative,
    Math.max(0, 1 + glucagonGainPerMgDl * (referenceGlucoseMgDl - glucoseMgDl)),
  );
  const glucagonRetention = 2 ** (-dtMin / glucagonHalfTimeMin);
  const glucagonRelative =
    glucagonTarget + (prev.glucagonRelative - glucagonTarget) * glucagonRetention;

  io.write({ insulinRelative, glucagonRelative });
}
