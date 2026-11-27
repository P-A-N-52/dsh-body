export type PublishedThermalInput = {
  readPublished?(id: 'feverDrive' | 'thermoregulation'): Readonly<{
    setpointOffsetC?: unknown;
    feverSetpointOffsetC?: unknown;
  }> | undefined;
};

export function nonnegativeFeverOffsetC(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function appliedFeverOffsetC(io: PublishedThermalInput): number {
  return nonnegativeFeverOffsetC(io.readPublished?.('thermoregulation')?.feverSetpointOffsetC);
}
