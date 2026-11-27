// 胆盐有效性门控水解和吸收、胰脂肪酶门控水解；所有量及速率为 M25 的 design 薄切片。
import { loadParameters } from '../../../lib/parameters.js';
import { committedActivity, nonNegative, parameter, saturate, splitOutflow, type LipidIO } from '../../human-compartments/lipid-circulation/kinetics.ts';

export const id = 'intestinalLipid';
const params = loadParameters(new URL('./lipid-absorption.parameters.json', import.meta.url));
const hydrolysisMax = parameter(params, 'intestinalLipid.hydrolysisMaxPerMin', { max: 5 });
const absorptionMax = parameter(params, 'intestinalLipid.absorptionMaxPerMin', { max: 5 });
const residueRate = parameter(params, 'intestinalLipid.residuePerMin', { max: 5 });
const bileHalf = parameter(params, 'intestinalLipid.bileHalfActivityU', { positive: true });
const lipaseHalf = parameter(params, 'intestinalLipid.lipaseHalfActivityU', { positive: true });

export const initialState = {
  lumenTgG: 0,
  hydrolyzedG: 0,
  residueTotalG: 0,
  hydrolyzedThisRoundG: 0,
  absorbedG: 0,
  residueG: 0,
};
const mass = { unit: 'g', mode: 'absolute' };
export const fields = {
  lumenTgG: { ...mass, transferIn: ['stomach.nonSolidFatG', 'stomach.solidFatG'] },
  hydrolyzedG: { ...mass, transferOut: ['intestinalLymph.tgInTransitG'] },
  residueTotalG: mass,
  hydrolyzedThisRoundG: mass,
  absorbedG: mass,
  residueG: mass,
};

export function heartbeat(io: LipidIO<typeof initialState>): void {
  const prev = io.read(id) ?? initialState;
  const lumenTgG = nonNegative(prev.lumenTgG, 'intestinalLipid.lumenTgG');
  const hydrolyzedG = nonNegative(prev.hydrolyzedG, 'intestinalLipid.hydrolyzedG');
  const start = io.simulatedSeconds - io.dt;
  const dtMin = io.dt / 60;
  const bile = saturate(committedActivity(io.read('gallbladder'), 'ductDeliveredActivityU', start), bileHalf);
  const lipase = saturate(committedActivity(io.read('pancreasExocrine'), 'lipaseActivityU', start), lipaseHalf);
  const [rawResidueG, hydrolyzedThisRoundG] = splitOutflow(lumenTgG, residueRate, hydrolysisMax * bile * lipase, dtMin);
  const [hydrolyzedResidueG, absorbedG] = splitOutflow(hydrolyzedG, residueRate, absorptionMax * bile, dtMin);
  const residueG = rawResidueG + hydrolyzedResidueG;

  io.write({
    lumenTgG: (lumenTgG - rawResidueG) - hydrolyzedThisRoundG,
    hydrolyzedG: (hydrolyzedG - hydrolyzedResidueG) + hydrolyzedThisRoundG,
    residueTotalG: nonNegative(prev.residueTotalG, 'intestinalLipid.residueTotalG') + residueG,
    hydrolyzedThisRoundG,
    absorbedG,
    residueG,
  });
  if (absorbedG > 0) io.transfer(id, 'hydrolyzedG', 'intestinalLymph', 'tgInTransitG', absorbedG);
}
