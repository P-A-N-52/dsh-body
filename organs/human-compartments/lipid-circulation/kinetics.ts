import { requireParameter } from '../../../lib/parameters.js';

export type SnapshotPart = Readonly<Record<string, unknown>>;
export type LipidIO<State> = {
  read(id: string): SnapshotPart | undefined;
  readonly dt: number;
  readonly simulatedSeconds: number;
  write(next: State): void;
  transfer(fromPart: string, fromField: string, toPart: string, toField: string, amount: number): void;
};

export function nonNegative(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a finite non-negative number`);
  }
  return value;
}

export function parameter(values: Record<string, unknown>, key: string, { positive = false, max = Infinity } = {}): number {
  const value = nonNegative(requireParameter(values, key), key);
  if ((positive && value === 0) || value > max) throw new Error(`${key} out of range`);
  return value;
}

export function saturate(value: number, half: number): number {
  return value === 0 ? 0 : 1 / (1 + half / value);
}

export function outflow(stock: number, ratePerMin: number, dtMin: number): number {
  return stock * -Math.expm1(-ratePerMin * dtMin);
}

export function splitOutflow(stock: number, firstRate: number, secondRate: number, dtMin: number): [number, number] {
  const totalRate = firstRate + secondRate;
  if (totalRate === 0) return [0, 0];
  const total = outflow(stock, totalRate, dtMin);
  const first = total * (firstRate / totalRate);
  return [first, total - first];
}

// 已提交的功能信号只支付下一轮；未加载部位可能仍留在旧存档里，不能永久重播。
export function committedActivity(part: SnapshotPart | undefined, field: string, startSimSeconds: number): number {
  return part?.activityAtSimSeconds === startSimSeconds ? nonNegative(part[field], field) : 0;
}
