/*
 * 部位 `epididymis`：附睾精液储存薄切片；本部位唯一写者，无动作、无 transfer，也不写其他部位。
 *
 * 消费者/输入：轮初快照里的 `sexualResponse.lastOrgasmAtSimMin` 是唯一事件输入；
 * `spermStorageMl` 与 `ejaculatedMl` 只写回本部位状态，供 body_state 与后续切片读取。
 * 这两个量是模型内精液体积占位，不是精液分析、精子计数/活力/形态、附睾容量或生育力指标，
 * 不能与 mL、百万/mL 等实测值换算。
 *
 * 公式（design，dtMin = io.dt / 60）：
 *   spermStorageMl = min(prev.spermStorageMl + recoveryMlPerMin × dtMin, capacityMl)
 *   若轮初 `sexualResponse.lastOrgasmAtSimMin` 等于本轮轮初仿真分钟
 *   （(io.simulatedSeconds − io.dt) / 60）：
 *     ejaculatedMl = prev.spermStorageMl（只结算轮初存量）
 *     spermStorageMl = 0（当轮恢复量一并丢弃，与“排空”一致）
 *   否则 ejaculatedMl = 0。
 *
 * 轮时序：`sexualResponse` 在高潮轮把 `lastOrgasmAtSimMin` 记为轮末仿真分钟，该值只出现在
 * 下一轮的轮初快照里；下一轮轮初分钟 = (io.simulatedSeconds − io.dt) / 60，因此排空比高潮
 * 晚一轮（60 s 轮下 1 min）记账，且只触发一次。不直接读 `io.actions`，也不因同轮 `orgasm`
 * 动作提前排空；`sexualResponse` 未加载时永远不排空。已加载但 `lastOrgasmAtSimMin` 缺失、
 * 非有限、非数值或为负时抛错让本轮失败且不写状态；`null` 是“从未高潮”的合法值。
 *
 * 参数在同目录 `storage.parameters.json`，两项全部 `status: design`、`source: null`；
 * 恢复速率、容量、初始 0 与公式本身都是工程假设，不是人体测量、拟合或临床验证。
 *
 * 未建模（design）：精子发生与成熟、前列腺/精囊液、射精反射与不应期、精液分析参数、
 * 生育力/受孕、性传播感染、年龄/BMI/疾病/药物影响、个体与场景差异。输出只含两个有限
 * 数字段，JSON-safe。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'epididymis';
export const actionTypes: string[] = [];

type EpididymisState = {
  spermStorageMl: number;
  ejaculatedMl: number;
};

type SexualResponseReading = {
  lastOrgasmAtSimMin?: unknown;
};

type IO = {
  read(id: 'epididymis'): Readonly<EpididymisState> | undefined;
  read(id: 'sexualResponse'): Readonly<SexualResponseReading> | undefined;
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: EpididymisState): void;
};

const parameters = loadParameters(new URL('./storage.parameters.json', import.meta.url));
const recoveryMlPerMin = requireParameter(parameters, 'epididymis.recoveryMlPerMin');
const capacityMl = requireParameter(parameters, 'epididymis.capacityMl');

export const initialState: EpididymisState = {
  spermStorageMl: 0,
  ejaculatedMl: 0,
};

export const fields = {
  spermStorageMl: { unit: 'mL', mode: 'absolute' },
  ejaculatedMl: { unit: 'mL', mode: 'absolute' },
};

function readLastOrgasmAtSimMin(io: IO): number | null {
  const response = io.read('sexualResponse');
  if (response === undefined) return null;
  if (typeof response !== 'object' || response === null) {
    throw new Error('epididymis: sexualResponse must be an object');
  }

  const value = response.lastOrgasmAtSimMin;
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(
      'epididymis: sexualResponse.lastOrgasmAtSimMin must be null or a finite non-negative number',
    );
  }
  return value;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtMin = io.dt / 60;
  const roundStartSimMin = (io.simulatedSeconds - io.dt) / 60;
  const lastOrgasmAtSimMin = readLastOrgasmAtSimMin(io);
  const ejaculated = lastOrgasmAtSimMin !== null && lastOrgasmAtSimMin === roundStartSimMin;
  const recoveredMl = Math.min(
    prev.spermStorageMl + recoveryMlPerMin * dtMin,
    capacityMl,
  );

  io.write({
    spermStorageMl: ejaculated ? 0 : recoveredMl,
    ejaculatedMl: ejaculated ? prev.spermStorageMl : 0,
  });
}
