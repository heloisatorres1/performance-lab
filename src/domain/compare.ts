import { botScript, build, device, scenario } from './catalog';
import type { Report } from './report';
import type { Ruleset } from './verdict';

export interface ConditionCheck {
  label: string;
  baseline: string;
  candidate: string;
  match: boolean;
}

/** Conditions that must match before an automatic regression verdict is allowed. */
export function conditionChecks(a: Report, b: Report): ConditionCheck[] {
  const ca = a.session.config;
  const cb = b.session.config;
  const da = device(ca.deviceId)!;
  const db = device(cb.deviceId)!;
  const script = (r: Report) => {
    const c = r.session.config;
    if (c.playMode !== 'bot') return 'Manual play';
    const s = botScript(c.botScriptId);
    return s ? `${s.name} v${s.version}, seed ${s.seed}` : 'Unknown script';
  };
  const capture = (c: typeof ca) => (c.capture === 'screenshots' ? `Screenshots every ${c.captureIntervalSec} s` : c.capture === 'video' ? 'Video' : 'Off');
  const power = (r: Report) => (r.battery.chargingSeconds > 0 ? 'External power reported' : 'On battery');
  const startBattery = (r: Report) => r.battery.startLevel;
  const startTemp = (r: Report) => r.temperature?.first ?? r.tel.series.temperature?.find((x) => x.v !== null)?.v ?? null;
  const ba = startBattery(a);
  const bb = startBattery(b);
  const ta = startTemp(a);
  const tb = startTemp(b);
  const versions = (r: Report) => Object.values(r.session.collectorVersions).join(', ');
  const row = (label: string, x: string, y: string, match = x === y): ConditionCheck => ({ label, baseline: x, candidate: y, match });
  return [
    row('Device and OS', `${da.name} · ${da.os}`, `${db.name} · ${db.os}`),
    row('Scenario', scenario(ca.scenarioId)?.name ?? ca.scenarioId, scenario(cb.scenarioId)?.name ?? cb.scenarioId),
    row('Play mode / script', script(a), script(b)),
    row('Target frame rate', `${ca.targetFps} FPS`, `${cb.targetFps} FPS`),
    row('Display', da.display, db.display),
    row('Connection', ca.connection === 'usb' ? 'USB' : 'Wireless', cb.connection === 'usb' ? 'USB' : 'Wireless'),
    row('Screen capture', capture(ca), capture(cb)),
    row('Power state', power(a), power(b)),
    row('Battery at start', ba === null ? 'n/a' : `${ba}%`, bb === null ? 'n/a' : `${bb}%`, ba === null || bb === null ? ba === bb : Math.abs(ba - bb) <= 10),
    row('Starting battery temperature', ta === null ? 'n/a' : `${ta.toFixed(1)} °C`, tb === null ? 'n/a' : `${tb.toFixed(1)} °C`, ta === null || tb === null ? ta === tb : Math.abs(ta - tb) <= 3),
    row('Duration', `${(a.session.recordedMs / 60000).toFixed(1)} min`, `${(b.session.recordedMs / 60000).toFixed(1)} min`, Math.abs(a.session.recordedMs - b.session.recordedMs) <= 30000),
    row('Warm-up excluded', `${ca.warmupSec} s`, `${cb.warmupSec} s`),
    row('Collector versions', versions(a), versions(b)),
  ];
}

export interface Delta {
  id: string;
  label: string;
  unit: string;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  /** Which direction is generally preferable. */
  better: 'higher' | 'lower';
  limit?: number;
  exceeds: boolean;
  decimals: number;
}

export function deltas(a: Report, b: Report, rs: Ruleset): Delta[] {
  const d = (id: string, label: string, unit: string, x: number | null | undefined, y: number | null | undefined, better: 'higher' | 'lower', decimals: number, limit?: number): Delta => {
    const bx = x ?? null;
    const cy = y ?? null;
    const delta = bx === null || cy === null ? null : cy - bx;
    const worse = delta === null ? 0 : better === 'higher' ? -delta : delta;
    return { id, label, unit, baseline: bx, candidate: cy, delta, better, limit, exceeds: limit !== undefined && worse > limit, decimals };
  };
  return [
    d('avg-fps', 'Average frame rate', 'FPS', a.frames?.avgFps, b.frames?.avgFps, 'higher', 1, rs.maxAvgFpsDecrease),
    d('p95', 'p95 frame time', 'ms', a.frames?.p95FrameMs, b.frames?.p95FrameMs, 'lower', 1, rs.maxP95IncreaseMs),
    d('below', `Time below ${rs.belowTargetFps} FPS`, '%', a.frames?.belowTarget.pct, b.frames?.belowTarget.pct, 'lower', 1),
    d('peak-mem', 'Peak memory (PSS)', 'MB', a.memory?.max, b.memory?.max, 'lower', 0, rs.maxPeakMemoryIncreaseMb),
    d('battery', 'Battery drop', 'pp', a.battery.dropPp, b.battery.dropPp, 'lower', 0),
  ];
}

export type CompareVerdict = { state: 'blocked' | 'review' | 'no-regression' | 'acknowledged-review' | 'acknowledged-ok'; reason: string };

export function compareVerdict(checks: ConditionCheck[], ds: Delta[], acknowledged: boolean): CompareVerdict {
  const mismatches = checks.filter((c) => !c.match);
  const exceeded = ds.filter((d) => d.exceeds);
  const detail = exceeded.length ? `${exceeded.map((d) => d.label).join(', ')} threshold exceeded` : 'no threshold exceeded';
  if (mismatches.length && !acknowledged) {
    return { state: 'blocked', reason: `Conditions differ (${mismatches.map((m) => m.label.toLowerCase()).join(', ')}). Acknowledge the limitations to see a verdict.` };
  }
  if (mismatches.length) return { state: exceeded.length ? 'acknowledged-review' : 'acknowledged-ok', reason: `Limitations acknowledged · ${detail}` };
  return exceeded.length ? { state: 'review', reason: `Review needed · ${detail}` } : { state: 'no-regression', reason: 'No threshold exceeded in this pair of runs' };
}

export const buildVersion = (r: Report) => build(r.session.config.buildId)?.version ?? '?';
