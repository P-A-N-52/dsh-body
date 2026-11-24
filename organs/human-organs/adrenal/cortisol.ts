/*
 * 肾上腺皮质相对皮质醇信号脚本；部位 `adrenal` 的唯一写者。
 *
 * 消费者：`liver`（按 `cortisolRelative` 缩放肝糖原释放速率）与 `interoception`
 * （转成 `stressMm` 读数）。`cortisolRelative` 是无量纲相对信号，1 表示基线；它不是
 * µg/dL、nmol/L、分泌率、血浆皮质醇浓度或 ACTH 浓度，不能与实测值换算。
 *
 * 公式（design）：
 *   dtMin = io.dt / 60
 *   cortisolRelative = clamp(acthRelative + (prevCortisol − acthRelative) × 2^(−dtMin / 15), 0, 3)
 * 读轮初 `pituitary.acthRelative`；`pituitary` 未加载时按 1 回退。15 min 半时来自
 * 同目录 `cortisol.parameters.json` 的 `adrenal.responseHalfTimeMin`，不是实测 HPA 轴
 * 动力学、皮质醇半衰期或 ACTH 剂量反应。ACTH 高于基线时皮质醇上移、低于基线时下移，
 * 两者都是一阶趋近；不建模脉冲分泌、昼夜节律、结合蛋白、受体、上游负反馈（在垂体与
 * 下丘脑侧）或肾上腺增生/功能减退。
 *
 * 只读轮初快照：本脚本不写 `pituitary`、`liver` 或 `glucose`，无 transfer、动作或通知。
 * 已加载的 `pituitary` 若缺 `acthRelative`、非数值、非有限或为负则抛错让本轮失败，
 * 不写状态；合法 0 是有效相对信号，不当作缺失。输出只含一个有限数字段，JSON-safe。
 *
 * 证据与未验证：没有皮质醇绝对浓度、ACTH 剂量反应或 HPA 轴时程的直接证据；15 min 半时、
 * 初始 1 以及公式本身全部是 `status: design`、`source: null` 的工程假设，不能称拟合、
 * 实测或临床验证。未建模：肾上腺髓质/肾上腺素、醛固酮、昼夜节律、应激输入，以及免疫与
 * 代谢的其它效应；`liver` 与 `interoception` 如何消费该信号由各自脚本决定。
 */
import { loadParameters, requireParameter } from '../../../lib/parameters.js';

export const id = 'adrenal';
export const actionTypes: string[] = [];

type AdrenalState = {
  cortisolRelative: number;
};

type PituitaryReading = {
  acthRelative?: unknown;
};

const parameters = loadParameters(new URL('./cortisol.parameters.json', import.meta.url));
const responseHalfTimeMin = requireParameter(
  parameters,
  'adrenal.responseHalfTimeMin',
);
const MIN_RELATIVE = 0;
const MAX_RELATIVE = 3;

export const initialState: AdrenalState = {
  cortisolRelative: 1,
};

export const fields = {
  cortisolRelative: { unit: '1', mode: 'absolute' },
};

type IO = {
  read(id: 'adrenal'): Readonly<AdrenalState> | undefined;
  read(id: 'pituitary'): Readonly<PituitaryReading> | undefined;
  readonly dt: number;
  write(next: AdrenalState): void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const pituitary = io.read('pituitary');

  let acthRelative = 1;
  if (pituitary !== undefined) {
    const reading = pituitary.acthRelative;
    if (typeof reading !== 'number' || !Number.isFinite(reading) || reading < 0) {
      throw new Error(
        `adrenal: invalid pituitary.acthRelative: ${String(reading)}`,
      );
    }
    acthRelative = reading;
  }

  const dtMin = io.dt / 60;
  const retention = 2 ** (-dtMin / responseHalfTimeMin);
  const cortisolRelative = clamp(
    acthRelative + (prev.cortisolRelative - acthRelative) * retention,
    MIN_RELATIVE,
    MAX_RELATIVE,
  );

  io.write({ cortisolRelative });
}
