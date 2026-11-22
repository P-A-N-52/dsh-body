/*
 * 膀胱（bladder）储尿、主动排尿与过度充盈非自主排空脚本；部位 `bladder` 的唯一写者。
 * 尿从 `bodyFluid.waterVolumeMl` 经 transfer 进入 `volumeMl`；排尿（无论主动还是非自主）只结算
 * 轮初体积，不反向扣体液、不调用 transfer：水转入膀胱时已经离开体液隔室，排尿再扣一次会双扣。
 *
 * 证据：
 * - SRC-ABRAMS-2002 / abrams-2002（DOI 10.1002/nau.10052，§3.2.4）：
 *   `organs/human-organs/bladder/references/notes/abrams-2002.md`。只支撑“排前量 = 排出量 +
 *   排后余量”的记账恒等式；原文没有规定正常排后余量。本脚本
 *   `bladder.voiding.postVoidResidualMl = 0 mL` 是 `design`，不是人体测量，也不能当作
 *   “正常残余量”的结论。
 *
 * 工程假设（design）：
 * - `voidedMl` 是本轮离开身体的总尿量，等于 `voluntaryVoidedMl` + `involuntaryVoidedMl` 两个分项；
 *   水账只按总量累计一次，不能把两个分项再加一遍。
 * - 主动排尿：只要本轮至少一个 `urinate`，就按轮初 `volumeMl` 排空到 `postVoidResidualMl`；
 *   多个不同动作同轮只结算一次，`voidedMl` 不是累计值。主动动作优先于非自主排空，两者不重复结算。
 * - 非自主排空：没有 `urinate` 且轮初 `volumeMl` 严格大于
 *   `bladder.voiding.involuntaryThresholdMl = 600 mL` 时，同样排空到 `postVoidResidualMl`，
 *   记入 `involuntaryVoidedMl`。600 mL 只是高于 410 mL 尿意归一化锚点的工程触发点
 *   （`design`、`source: null`），不是正常膀胱容量、临床诊断界值或论文测量。它不模拟逼尿肌、
 *   尿道括约肌、正常排尿反射或临床尿失禁，也不是持续漏尿或漏尿速率；只是“内容物过多”时
 *   一次性排到既有排后余量的工程代理。
 * - 先 write、后 transfer：write 写入本轮转出后的基准体积（当轮新尿尚未加入），Gateway 随后把
 *   体液转入的尿加在 write 之上。因此“当轮新尿不在同轮排出”，下一轮才参与判断与排尿。
 * - 排尿由会话动作或阈值代理触发，不建夜尿、尿急综合征、逼尿肌压力/尿流率或残余尿诊断。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'bladder';
export const actionTypes = ['urinate'];

type BladderState = {
  volumeMl: number;
  voidedMl: number;
  voluntaryVoidedMl: number;
  involuntaryVoidedMl: number;
};

export const initialState: BladderState = {
  volumeMl: 0,
  voidedMl: 0,
  voluntaryVoidedMl: 0,
  involuntaryVoidedMl: 0,
};

export const fields = {
  volumeMl: { unit: 'mL', mode: 'absolute', transferIn: ['bodyFluid.waterVolumeMl'] },
  voidedMl: { unit: 'mL', mode: 'absolute' },
  voluntaryVoidedMl: { unit: 'mL', mode: 'absolute' },
  involuntaryVoidedMl: { unit: 'mL', mode: 'absolute' },
};

type Action = {
  readonly type?: unknown;
};

type IO = {
  read(id: 'bladder'): Readonly<BladderState> | undefined;
  readonly actions: readonly Action[];
  write(next: BladderState): void;
};

const parameters = loadParameters(new URL('./storage.parameters.json', import.meta.url));
const postVoidResidualMl = requireParameter(parameters, 'bladder.voiding.postVoidResidualMl');
const involuntaryThresholdMl = requireParameter(parameters, 'bladder.voiding.involuntaryThresholdMl');

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const volumeStart = Math.max(0, finiteOrZero(prev.volumeMl));
  const availableMl = Math.max(0, volumeStart - postVoidResidualMl);
  const shouldVoid = io.actions.some((action) => action?.type === 'urinate');
  let voluntaryVoidedMl = 0;
  let involuntaryVoidedMl = 0;

  if (shouldVoid) {
    voluntaryVoidedMl = availableMl;
  } else if (volumeStart > involuntaryThresholdMl) {
    involuntaryVoidedMl = availableMl;
  }

  const voidedMl = voluntaryVoidedMl + involuntaryVoidedMl;
  io.write({
    volumeMl: Math.max(0, volumeStart - voidedMl),
    voidedMl,
    voluntaryVoidedMl,
    involuntaryVoidedMl,
  });
}
