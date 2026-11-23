/*
 * 骨骼肌活动 P0 脚本：部位 `physicalActivity`，字段 `remainingExerciseMin`（单位 `min`）与
 * `intensity`（单位 `1`，模型内相对强度，不是 MET）。无新动作时按 `io.dt` 递减剩余时间，
 * 归零时强度归 0；同一轮只取最后一条合法 `exercise` 或 `sex`（性活动按体力活动计入），用其
 * `durationMin`/`intensity` 替换剩余活动，不累加时长；两类动作共用同一校验与字段。非法动作
 * 不改变活动状态；其他类型动作无影响。本脚本不自动运动、不发通知、不写其他部位；
 * `skin/sweat.ts` 后续读取本部位的轮初快照。
 *
 * design（不是人体测量、拟合或独立验证）
 * - “按 dt 递减、归零清强度、最后一条有效动作替换”是动作策略（design/policy），
 *   不是运动生理规律；同轮多条动作的取舍不影响幂等语义，只决定本轮终值。
 * - `sex` 计入体力活动是 design：不区分动作类型、姿势、伴侣或性别差异，也不代表已测能量
 *   消耗；`intensity` 仍是模型内相对强度，不是 MET、心率、耗氧量或能量消耗。
 * - 不建模运动类型、姿势、肌糖原、疲劳、心肺反应、核心/皮肤温度、体温调节或个体差异。
 * - 旧存档缺字段按 0，不反推过去活动；剩余时间与强度随存档保留，重启可续用。
 * - 未登记来源：本切片不引入实测代谢或体温数据，字段、阈值与行为均无人体测量支撑。
 */
export const id = 'physicalActivity';
export const actionTypes = ['exercise', 'sex'];

type ActivityState = {
  remainingExerciseMin: number;
  intensity: number;
};

type SavedActivityState = {
  readonly remainingExerciseMin?: unknown;
  readonly intensity?: unknown;
};

type Action = {
  readonly type?: unknown;
  readonly intensity?: unknown;
  readonly durationMin?: unknown;
};

type IO = {
  read(id: 'physicalActivity'): Readonly<SavedActivityState> | undefined;
  readonly actions: readonly Action[];
  readonly dt: number;
  write(next: ActivityState): void;
};

export const initialState: ActivityState = {
  remainingExerciseMin: 0,
  intensity: 0,
};

export const fields = {
  remainingExerciseMin: { unit: 'min', mode: 'absolute' },
  intensity: { unit: '1', mode: 'absolute' },
};

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function activityReplacement(action: Action): ActivityState | undefined {
  if (action.type !== 'exercise' && action.type !== 'sex') return undefined;

  const { intensity, durationMin } = action;
  if (typeof intensity !== 'number'
    || !Number.isFinite(intensity)
    || intensity <= 0
    || intensity > 1) {
    return undefined;
  }
  if (typeof durationMin !== 'number' || !Number.isFinite(durationMin) || durationMin <= 0) {
    return undefined;
  }

  return { remainingExerciseMin: durationMin, intensity };
}

export function heartbeat(io: IO): void {
  const prev = io.read(id) ?? initialState;
  const dtMin = Math.max(0, finiteOr(io.dt, 0) / 60);
  const remainingExerciseMin = Math.max(0, finiteOr(prev.remainingExerciseMin, 0) - dtMin);

  let next: ActivityState = {
    remainingExerciseMin,
    intensity: remainingExerciseMin > 0 ? finiteOr(prev.intensity, 0) : 0,
  };

  for (const action of io.actions) {
    const replacement = activityReplacement(action);
    if (replacement !== undefined) next = replacement;
  }

  io.write(next);
}
