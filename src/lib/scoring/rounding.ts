import { TASK2_WEIGHT } from "../config";

export function roundHalf(x: number): number {
  const r = Math.round(x * 10000) / 10000; // hilangkan noise floating point
  const whole = Math.floor(r);
  const frac = r - whole;
  if (frac < 0.25) return whole;
  if (frac < 0.75) return whole + 0.5;
  return whole + 1;
}

export const taskBandRaw = (b: [number, number, number, number]) => (b[0] + b[1] + b[2] + b[3]) / 4;
export const writingBandRaw = (t1Raw: number, t2Raw: number) =>
  (t1Raw + TASK2_WEIGHT * t2Raw) / (1 + TASK2_WEIGHT);

export function taskBand(b: [number, number, number, number]): { raw: number; band: number } {
  const raw = taskBandRaw(b);
  return { raw, band: roundHalf(raw) };
}

export function writingBand(t1Raw: number, t2Raw: number): { raw: number; band: number } {
  const raw = writingBandRaw(t1Raw, t2Raw);
  return { raw, band: roundHalf(raw) };
}

/** Target band polished (bagian 1). null = tombol polished tidak ditampilkan. */
export function polishTarget(taskBandValue: number): number | null {
  if (taskBandValue >= 9) return null;
  if (taskBandValue < 7) return 7;
  return Math.min(9, taskBandValue + 1);
}
