/*
 * 膀胱（bladder）储尿与主动排尿脚本；部位 `bladder` 的唯一写者。
 * 尿从 `bodyFluid.waterVolumeMl` 经 transfer 进入 `volumeMl`；主动 `urinate` 只结算轮初体积，
 * 不反向扣体液：水转入膀胱时已经离开体液隔室，排尿再扣一次会双扣。
 *
 * 证据：
 * - SRC-ABRAMS-2002 / abrams-2002（DOI 10.1002/nau.10052，§3.2.4）：
 *   `organs/human-organs/bladder/references/notes/abrams-2002.md`。只支撑“排前量 = 排出量 +
 *   排后余量”的记账恒等式；原文没有规定正常排后余量。本脚本
 *   `bladder.voiding.postVoidResidualMl = 0 mL` 是 `design`，不是人体测量，也不能当作
 *   “正常残余量”的结论。
 *
 * 工程假设（design）：
 * - 只要本轮至少一个 `urinate`，就按轮初 `volumeMl` 排空到 `postVoidResidualMl`；多个不同动作同轮
 *   只结算一次，`voidedMl` 不是累计值。
 * - 先 write、后 transfer：write 写入本轮转出后的基准体积（当轮新尿尚未加入），Gateway 随后把体液
 *   转入的尿加在 write 之上。因此“当轮新尿不在同轮排出”，下一轮才参与排尿。
 * - 排尿是有意的会话动作，不自动触发；没有尿意阈值、失禁、夜尿或逼尿肌压力/尿流率建模。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'bladder';
export const actionTypes = ['urinate'];

type BladderState = {
  volumeMl: number;
  voidedMl: number;
};

export const initialState: BladderState = {
  volumeMl: 0,
  voidedMl: 0,
};

export const fields = {
  volumeMl: { unit: 'mL', mode: 'absolute', transferIn: ['bodyFluid.waterVolumeMl'] },
  voidedMl: { unit: 'mL', mode: 'absolute' },
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

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const volumeStart = Math.max(0, finiteOrZero(prev.volumeMl));
  const shouldVoid = io.actions.some((action) => action?.type === 'urinate');
  const voidedMl = shouldVoid ? Math.max(0, volumeStart - postVoidResidualMl) : 0;

  io.write({
    volumeMl: Math.max(0, volumeStart - voidedMl),
    voidedMl,
  });
}
