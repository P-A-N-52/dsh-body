export function initialize(_snapshot, { initialParts, resetOnStart }) {
  const patches = [];
  for (const [id, fields] of Object.entries(resetOnStart)) {
    if (fields.length === 0) continue;
    const resetValues = fields.map((field) => [field, initialParts[id][field]]);
    patches.push([id, Object.fromEntries(resetValues)]);
  }
  return Object.fromEntries(patches);
}
