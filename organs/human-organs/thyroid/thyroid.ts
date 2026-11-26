/*
 * 甲状腺（thyroid）：TSH 驱动的 T4 相对信号；部位 `thyroid` 的唯一写者。
 *
 * 消费者：`bloodOxygen` 用 `thyroxineRelative` 缩放基础氧耗
 * （`basalMlMin × (0.8 + 0.4 × thyroxineRelative)`）；T4 还经
 * `hypothalamusEndocrine` 与 `pituitary` 反向抑制 TRH/TSH，负反馈闭环由上游轴脚本读取。
 *
 * 公式（design，`dtMin = io.dt / 60`）：
 *   thyroxineRelative = tshRelative
 *     + (prevT4 − tshRelative) × 2^(−dtMin / thyroxineHalfTimeMin)
 * `prevT4` 是本部位轮初读数（旧档缺字段按 1），`tshRelative` 是轮初
 * `pituitary.tshRelative`（未加载按 1）。表观代谢/脱碘调节池半时默认 `1440 min`（24 h，
 * `SRC-NICOLOFF-1972` / `nicoloff-1972.md` 报道游离 T3 清除均值 ~24.0 h，标 `prior`；替代旧 `60 min`
 * 瞬时占位），来自同目录 `thyroid.parameters.json` 的 `thyroid.thyroxineHalfTimeMin`。
 *
 * `thyroxineRelative` 是 0–3 的无量纲相对量，`1` 表示基线；它不是 T4/T3 浓度、游离
 * 激素、分泌率或代谢率，不能与 µIU/mL、pmol/L 等实测值换算。初值 1 只是未受刺激的
 * 工程基线，不是人体正常值。T4 只调 `bloodOxygen` 的基础氧耗，不直接改血氧池状态、
 * 血糖、体温或行为；本脚本不处理动作、不调用 transfer/notify。
 *
 * 边界：`pituitary` 未加载时按 TSH = 1 回退；已加载但 `tshRelative` 缺失、非有限或为负
 * 时抛错使本轮失败且不写状态，不用健康常量掩盖异常。只读轮初快照；同轮新到动作和上游
 * 写入下一轮才反映。缺失 T3/T4 精细分室、甲状腺结合球蛋白、碘摄入、甲状腺疾病、昼夜差异与个体差异
 * 均未建模。
 *
 * 证据：仅 `thyroxineHalfTimeMin = 1440 min` 引用 `SRC-NICOLOFF-1972`（T3 全身清除 24.0 h 量级，
 * 标 `prior`）；一阶指数形式与 0–3 范围仍为 `status: design`，不能称实测、拟合或 `validated`。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'thyroid';
export const actionTypes: string[] = [];

type ThyroidState = {
  thyroxineRelative: number;
};

type PituitaryReading = {
  tshRelative?: unknown;
};

export const initialState: ThyroidState = {
  thyroxineRelative: 1,
};

export const fields = {
  thyroxineRelative: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(id: 'thyroid'): Readonly<ThyroidState> | undefined;
  read(id: 'pituitary'): Readonly<PituitaryReading> | undefined;
  readonly dt: number;
  write(next: ThyroidState): void;
};

const parameters = loadParameters(new URL('./thyroid.parameters.json', import.meta.url));
const thyroxineHalfTimeMin = requireParameter(parameters, 'thyroid.thyroxineHalfTimeMin');
const MIN_RELATIVE = 0;
const MAX_RELATIVE = 3;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readTshRelative(io: IO): number {
  const pituitary = io.read('pituitary');
  if (pituitary === undefined) return 1;
  const tshRelative = pituitary.tshRelative;
  if (typeof tshRelative !== 'number' || !Number.isFinite(tshRelative) || tshRelative < 0) {
    throw new Error('thyroid: pituitary.tshRelative must be a finite non-negative number');
  }
  return tshRelative;
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const tshRelative = readTshRelative(io);

  const dtMin = io.dt / 60;
  const retention = 2 ** (-dtMin / thyroxineHalfTimeMin);
  io.write({
    thyroxineRelative: clamp(
      tshRelative + (prev.thyroxineRelative - tshRelative) * retention,
      MIN_RELATIVE,
      MAX_RELATIVE,
    ),
  });
}
