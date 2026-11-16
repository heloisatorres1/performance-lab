import type { Capture, Gap, Sample } from './types';

/** Captures further than this from the selected time are not shown as evidence. */
export const ALIGN_TOLERANCE_MS = 1500;
/** Simulated clock uncertainty between telemetry and capture streams. */
export const CLOCK_UNCERTAINTY_MS = 50;

export type Alignment =
  | { kind: 'match'; capture: Capture; offsetMs: number }
  | { kind: 'none'; reason: 'no-captures' | 'capture-gap' | 'outside-tolerance'; nearestOffsetMs?: number };

/**
 * Picks the capture closest in time to `t`. The offset is signed: negative
 * means the capture was taken before the selected time. Captures outside the
 * tolerance are never presented as evidence for `t`.
 */
export function alignCapture(captures: Capture[], gaps: Gap[], t: number, tolerance = ALIGN_TOLERANCE_MS): Alignment {
  if (!captures.length) return { kind: 'none', reason: 'no-captures' };
  let lo = 0;
  let hi = captures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (captures[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [captures[lo - 1], captures[lo]].filter(Boolean) as Capture[];
  const best = candidates.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  const offset = best.t - t;
  if (Math.abs(offset) > tolerance) {
    const inCaptureGap = gaps.some((g) => (g.stream === 'capture' || g.stream === 'telemetry') && t >= g.fromMs && t < g.toMs);
    return { kind: 'none', reason: inCaptureGap ? 'capture-gap' : 'outside-tolerance', nearestOffsetMs: offset };
  }
  return { kind: 'match', capture: best, offsetMs: offset };
}

/** Value of a 1 Hz series at time t: the sample whose window contains t. Never interpolated. */
export function sampleAt(samples: Sample[] | undefined, t: number): Sample | undefined {
  if (!samples?.length) return undefined;
  const idx = Math.ceil(t / 1000) - 1;
  const s = samples[Math.max(0, Math.min(samples.length - 1, idx))];
  return s && Math.abs(s.t - t) <= 1000 ? s : undefined;
}

/** Frame interval of the frame presented closest at or before t. */
export function frameAt(frameT: Float64Array, frameDt: Float64Array, t: number): { t: number; dt: number } | undefined {
  let lo = 0;
  let hi = frameT.length - 1;
  if (hi < 0) return undefined;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frameT[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  if (frameT[lo] > t || t - frameT[lo] > 250) return undefined;
  return { t: frameT[lo], dt: frameDt[lo] };
}
