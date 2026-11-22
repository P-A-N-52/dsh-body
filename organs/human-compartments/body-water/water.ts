/*
 * 体液隔室（bodyFluid）：工程“体液水”总量与水分亏缺代理；部位 `bodyFluid` 的唯一写者。
 * 它是隔室而不是解剖器官，因此放在 `organs/human-compartments/body-water/`。
 *
 * 直接证据：无。`bodyFluid.referenceVolumeMl = 30000 mL` 与 `bodyFluid.deficitScaleMl = 500 mL`
 * 都是 `design`（同目录 `water.parameters.json`），不是实测总体水、血浆容量、体重比例或渗透压。
 * 设计依据是 `docs/superpowers/specs/2026-11-22-water-balance-design.md` §3.3。
 *
 * 工程假设（design）：
 * - `waterDeficit = clamp((referenceVolumeMl - W_start) / deficitScaleMl, -1, 1)`，
 *   其中 `W_start` 是本轮轮初的 `waterVolumeMl`；正值表示低于参考量，负值表示高于参考量。
 * - 本轮向膀胱的转出量 `U = clamp(kidney.urineProductionRequestMl, 0, W_start)`。
 * - `io.write` 交回的是**转出前**的 `W_start`；Gateway 在 transfer 阶段才扣 `U` 并加入小肠
 *   同轮转入。因此本轮请求只能由轮初水支付，当轮肠流入不能支付本轮 `U`。
 *
 * 不能推出：`waterDeficit` 是归一化代理，不是血浆渗透压、血容量、口渴或尿意评分；`U` 是请求量
 * 而不是瞬时尿流率。M3 首段不建血浆/尿渗、电解质、血容量/血压或 RAAS；上游胃水与小肠吸收的
 * 证据边界见对应器官 README，本文件不引用具体论文。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'bodyFluid';
export const actionTypes: string[] = [];

type BodyFluidState = {
  waterVolumeMl: number;
  waterDeficit: number;
};

type KidneyReading = {
  urineProductionRequestMl?: number;
};

const parameters = loadParameters(new URL('./water.parameters.json', import.meta.url));
const referenceVolumeMl = requireParameter(parameters, 'bodyFluid.referenceVolumeMl');
const deficitScaleMl = requireParameter(parameters, 'bodyFluid.deficitScaleMl');

export const initialState: BodyFluidState = {
  waterVolumeMl: referenceVolumeMl,
  waterDeficit: 0,
};

export const fields = {
  waterVolumeMl: {
    unit: 'mL',
    mode: 'absolute',
    transferIn: ['smallIntestine.waterVolumeMl'],
    transferOut: ['bladder.volumeMl'],
  },
  waterDeficit: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(id: 'bodyFluid'): Readonly<BodyFluidState> | undefined;
  read(id: 'kidney'): Readonly<KidneyReading> | undefined;
  write(next: BodyFluidState): void;
  transfer(
    fromPart: 'bodyFluid',
    fromField: 'waterVolumeMl',
    toPart: 'bladder',
    toField: 'volumeMl',
    amount: number,
  ): void;
};

function finiteOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const startVolumeMl = Math.max(0, finiteOrZero(prev.waterVolumeMl));
  const requestMl = Math.max(0, finiteOrZero(io.read('kidney')?.urineProductionRequestMl));
  const urineMl = Math.min(requestMl, startVolumeMl);
  const waterDeficit = clamp((referenceVolumeMl - startVolumeMl) / deficitScaleMl, -1, 1);

  io.write({ waterVolumeMl: startVolumeMl, waterDeficit });
  io.transfer(id, 'waterVolumeMl', 'bladder', 'volumeMl', urineMl);
}
