import type { FrameStats, SeriesStats } from './analysis';
import type { Session } from './types';

export interface Ruleset {
  id: string;
  version: number;
  projectId: string;
  name: string;
  minAvgFps: number;
  maxP95FrameMs: number;
  belowTargetFps: number;
  maxBelowTargetPct: number;
  maxPeakMemoryMb: number;
  minCoverage: number;
  /** Comparison thresholds. */
  maxP95IncreaseMs: number;
  maxAvgFpsDecrease: number;
  maxPeakMemoryIncreaseMb: number;
  updatedAt: string;
}

export type VerdictState = 'within' | 'review' | 'incomplete' | 'not-evaluated';

export const VERDICT_LABEL: Record<VerdictState, string> = {
  within: 'Within thresholds',
  review: 'Review needed',
  incomplete: 'Incomplete',
  'not-evaluated': 'Not evaluated',
};

export interface RuleResult {
  id: string;
  label: string;
  observed: number | null;
  limit: number;
  unit: string;
  comparator: '≥' | '≤';
  status: 'pass' | 'fail' | 'not-evaluated';
  note?: string;
}

export interface Verdict {
  state: VerdictState;
  reason: string;
  rulesetLabel: string;
  window: string;
  coverage: number;
  rules: RuleResult[];
}

/**
 * Evaluates only supported metrics with enough coverage, excluding warm-up.
 * Missing data never passes. "Review needed" is a QA signal, not a release
 * approval.
 */
export function evaluate(session: Session, frames: FrameStats | null, memory: SeriesStats | null, rs: Ruleset): Verdict {
  const rulesetLabel = `${rs.name} v${rs.version}`;
  const coverage = frames?.coverage ?? 0;
  const base = { rulesetLabel, window: frames?.window.label ?? '', coverage };
  if (session.state === 'interrupted' || session.endReason === 'disconnected' || session.endReason === 'browser-closed') {
    return { ...base, state: 'incomplete', reason: 'Recording was interrupted. Partial data is kept but cannot pass.', rules: [] };
  }
  if (session.endReason === 'bot-failed') return { ...base, state: 'incomplete', reason: 'The scripted bot failed. A clean benchmark verdict is not possible.', rules: [] };
  if (session.endReason === 'collector-failed') return { ...base, state: 'incomplete', reason: 'The collector failed during recording.', rules: [] };
  if (session.state === 'cancelled') return { ...base, state: 'not-evaluated', reason: 'Cancelled sessions are not benchmarks.', rules: [] };
  if (session.state !== 'complete') return { ...base, state: 'not-evaluated', reason: 'The session has not finished processing.', rules: [] };

  const rule = (id: string, label: string, observed: number | null | undefined, limit: number, unit: string, comparator: '≥' | '≤', available: boolean, note?: string): RuleResult => {
    if (!available || observed === null || observed === undefined) return { id, label, observed: null, limit, unit, comparator, status: 'not-evaluated', note: note ?? 'Metric not available' };
    const ok = comparator === '≥' ? observed >= limit : observed <= limit;
    return { id, label, observed, limit, unit, comparator, status: ok ? 'pass' : 'fail', note };
  };
  const hasFrames = !!frames && frames.frames > 0;
  const rules: RuleResult[] = [
    rule('avg-fps', 'Average frame rate', frames?.avgFps, rs.minAvgFps, 'FPS', '≥', hasFrames),
    rule('p95-frame', 'p95 frame time', frames?.p95FrameMs, rs.maxP95FrameMs, 'ms', '≤', hasFrames),
    rule('below-target', `Time below ${rs.belowTargetFps} FPS (1 s windows)`, frames?.belowTarget.pct, rs.maxBelowTargetPct, '%', '≤', hasFrames),
    rule('peak-memory', 'Peak memory (PSS)', memory?.max, rs.maxPeakMemoryMb, 'MB', '≤', !!memory && memory.n > 0),
  ];
  if (hasFrames && coverage < rs.minCoverage) {
    return { ...base, state: 'incomplete', reason: `Coverage ${(coverage * 100).toFixed(1)}% is below the required ${(rs.minCoverage * 100).toFixed(0)}%.`, rules };
  }
  const evaluated = rules.filter((r) => r.status !== 'not-evaluated');
  if (!evaluated.length) return { ...base, state: 'not-evaluated', reason: 'No supported metric could be evaluated.', rules };
  const failed = rules.filter((r) => r.status === 'fail');
  if (failed.length) return { ...base, state: 'review', reason: failed.map((r) => `${r.label} ${fmt(r.observed)} ${r.unit} (limit ${r.comparator} ${r.limit} ${r.unit})`).join('; '), rules };
  const skipped = rules.length - evaluated.length;
  return { ...base, state: 'within', reason: skipped ? `All evaluated rules pass. ${skipped} rule${skipped > 1 ? 's' : ''} not evaluated.` : 'All rules pass.', rules };
}

const fmt = (n: number | null) => (n === null ? '–' : Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1));
