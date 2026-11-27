import { loadParameters, requireParameter } from '../../lib/parameters.js';

export const id = 'clothing';
export const actionTypes = ['wear_layer', 'remove_layer'];
export const initialState = { wornLayerIds: [] as string[] };
export const fields = { wornLayerIds: { unit: 'layerId[]', mode: 'absolute' } };

type IO = {
  read(id: 'clothing'): Readonly<{ wornLayerIds: readonly string[] }> | undefined;
  readonly actions: readonly Readonly<Record<string, unknown>>[];
  write(next: typeof initialState): void;
};

const parameters = loadParameters(new URL('./clothing.parameters.json', import.meta.url));
const layers = new Map(['tshirt', 'jacket'].map((layerId) => {
  const dry = requireParameter(parameters, `clothing.${layerId}.dryExchangeMultiplier`);
  const evaporation = requireParameter(parameters, `clothing.${layerId}.evaporationMultiplier`);
  if (!Number.isFinite(dry) || dry <= 0 || dry > 1
    || !Number.isFinite(evaporation) || evaporation < 0 || evaporation > 1) {
    throw new Error(`clothing.${layerId}: expected dry multiplier in (0, 1] and evaporation multiplier in [0, 1]`);
  }
  return [layerId, { dry, evaporation }] as const;
}));

export function clothingMultipliers(wornLayerIds: readonly string[] = []) {
  let dryExchangeMultiplier = 1;
  let evaporationMultiplier = 1;
  for (const layerId of new Set(wornLayerIds)) {
    const layer = layers.get(layerId);
    if (!layer) continue;
    dryExchangeMultiplier *= layer.dry;
    evaporationMultiplier *= layer.evaporation;
  }
  return { dryExchangeMultiplier, evaporationMultiplier };
}

export function heartbeat(io: IO): void {
  const worn = new Set(io.read(id)?.wornLayerIds ?? initialState.wornLayerIds);
  let changed = false;
  for (const { type, layerId } of io.actions) {
    if (typeof layerId !== 'string' || !layers.has(layerId)) continue;
    if (type === 'wear_layer' && !worn.has(layerId)) {
      worn.add(layerId);
      changed = true;
    } else if (type === 'remove_layer' && worn.delete(layerId)) {
      changed = true;
    }
  }
  if (changed) io.write({ wornLayerIds: [...worn] });
}
