import type { Gap, MetricId, Sample, Session, Telemetry } from './types';

// Report statistics are always computed from raw eligible observations, never
// from chart decimation. Definitions are written next to each calculation and
// repeated in the report so a reader can check them.

export interface Window {
  fromMs: number;
  toMs: number;
  label: string;
}

/** Frame and telemetry summaries exclude warm-up. Battery uses the full session. */
export function analysisWindow(s: Session): Window {
  const from = Math.min(s.config.warmupSec * 1000, s.recordedMs);
  return { fromMs: from, toMs: s.recordedMs, label: `${fmtClock(from)}–${fmtClock(s.recordedMs)} (warm-up ${s.config.warmupSec} s excluded)` };
}

export function fullWindow(s: Session): Window {
  return { fromMs: 0, toMs: s.recordedMs, label: `00:00–${fmtClock(s.recordedMs)} (full session)` };
}

export function gapOverlapMs(gaps: Gap[], w: { fromMs: number; toMs: number }) {
  let total = 0;
  for (const g of gaps) {
    if (g.stream !== 'telemetry') continue;
    total += Math.max(0, Math.min(g.toMs, w.toMs) - Math.max(g.fromMs, w.fromMs));
  }
  return total;
}

/**
 * Nearest-rank percentile on raw values: the smallest value such that at
 * least p% of observations are ≤ it. No interpolation.
 */
export function percentile(values: ArrayLike<number>, p: number): number | null {
  if (!values.length) return null;
  const sorted = Float64Array.from(values as ArrayLike<number>).sort();
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

export interface FrameStats {
  window: Window;
  frames: number;
  validSeconds: number;
  coverage: number;
  /** Valid presented frames ÷ valid observed seconds. */
  avgFps: number | null;
  p50FrameMs: number | null;
  p95FrameMs: number | null;
  p99FrameMs: number | null;
  maxFrameMs: number | null;
  /** Frames whose interval exceeded 2 × the target frame time. */
  slowFrames: number;
  slowFrameThresholdMs: number;
  belowTarget: BelowTarget;
}

export interface BelowTarget {
  thresholdFps: number;
  windowSec: number;
  windowsBelow: number;
  windowsEvaluated: number;
  /** Share of valid observed time spent in 1 s windows below the threshold. */
  pct: number | null;
}

export function frameStats(s: Session, tel: Telemetry, belowTargetFps: number, w: Window = analysisWindow(s)): FrameStats {
  const span = Math.max(0, w.toMs - w.fromMs);
  const validMs = span - gapOverlapMs(tel.gaps, w);
  const eligible: number[] = [];
  for (let i = 0; i < tel.frameT.length; i++) if (tel.frameT[i] > w.fromMs && tel.frameT[i] <= w.toMs) eligible.push(tel.frameDt[i]);
  const target = s.config.targetFps;
  const slowThreshold = (2 * 1000) / target;
  const has = eligible.length > 0 && validMs > 0;
  return {
    window: w,
    frames: eligible.length,
    validSeconds: validMs / 1000,
    coverage: span ? validMs / span : 0,
    avgFps: has ? eligible.length / (validMs / 1000) : null,
    p50FrameMs: percentile(eligible, 50),
    p95FrameMs: percentile(eligible, 95),
    p99FrameMs: percentile(eligible, 99),
    maxFrameMs: has ? eligible.reduce((a, b) => (b > a ? b : a), 0) : null,
    slowFrames: eligible.filter((d) => d > slowThreshold).length,
    slowFrameThresholdMs: slowThreshold,
    belowTarget: belowTarget(tel.series.fps ?? [], belowTargetFps, w),
  };
}

/** Uses the 1 s FPS windows. Windows with no valid data are excluded, not counted as zero. */
export function belowTarget(fps: Sample[], thresholdFps: number, w: { fromMs: number; toMs: number }): BelowTarget {
  const inWindow = fps.filter((x) => x.t - 1000 >= w.fromMs && x.t <= w.toMs && x.v !== null);
  const below = inWindow.filter((x) => (x.v as number) < thresholdFps).length;
  return { thresholdFps, windowSec: 1, windowsBelow: below, windowsEvaluated: inWindow.length, pct: inWindow.length ? (below / inWindow.length) * 100 : null };
}

export interface SeriesStats {
  metric: MetricId;
  n: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  first: number | null;
  last: number | null;
}

export function seriesStats(metric: MetricId, samples: Sample[] | undefined, w: { fromMs: number; toMs: number }): SeriesStats | null {
  if (!samples) return null;
  const vals = samples.filter((x) => x.t > w.fromMs && x.t <= w.toMs && x.v !== null).map((x) => x.v as number);
  if (!vals.length) return { metric, n: 0, min: null, avg: null, max: null, first: null, last: null };
  return { metric, n: vals.length, min: Math.min(...vals), avg: vals.reduce((a, b) => a + b, 0) / vals.length, max: Math.max(...vals), first: vals[0], last: vals[vals.length - 1] };
}

export interface BatteryStats {
  window: Window;
  status: 'ok' | 'charging' | 'no-data' | 'not-captured';
  startLevel: number | null;
  endLevel: number | null;
  /** Percentage points, not a relative percentage. */
  dropPp: number | null;
  ppPerHour: number | null;
  durationMin: number;
  chargingSeconds: number;
  granularityPct: 1;
  chargeConsumedMah: number | null;
  avgPowerW: number | null;
  energyWh: number | null;
  powerNote: string;
}

export function batteryStats(s: Session, tel: Telemetry, currentSupported: boolean, voltageSupported: boolean, counterSupported: boolean): BatteryStats {
  const w = fullWindow(s);
  const levels = (tel.series.battery ?? []).filter((x) => x.v !== null);
  const durationMin = s.recordedMs / 60000;
  const chargingSeconds = tel.charging.filter((c) => c.charging).length;
  const base: BatteryStats = {
    window: w,
    status: 'ok',
    startLevel: null,
    endLevel: null,
    dropPp: null,
    ppPerHour: null,
    durationMin,
    chargingSeconds,
    granularityPct: 1,
    chargeConsumedMah: null,
    avgPowerW: null,
    energyWh: null,
    powerNote: '',
  };
  if (!tel.series.battery) return { ...base, status: 'not-captured', powerNote: 'Battery was not captured in this session.' };
  if (!levels.length) return { ...base, status: 'no-data', powerNote: 'No battery samples were observed.' };
  const startLevel = levels[0].v as number;
  const endLevel = levels[levels.length - 1].v as number;
  const observedMs = levels[levels.length - 1].t - levels[0].t + 1000;
  if (chargingSeconds > 0) {
    return { ...base, status: 'charging', startLevel, endLevel, powerNote: `External power was reported for ${chargingSeconds} s. Discharge analysis is not valid for this session.` };
  }
  const dropPp = startLevel - endLevel;
  const out: BatteryStats = { ...base, startLevel, endLevel, dropPp, ppPerHour: dropPp / (observedMs / 3600000) };

  const cc = tel.series.chargeCounter?.filter((x) => x.v !== null);
  if (counterSupported && cc && cc.length > 1) out.chargeConsumedMah = ((cc[0].v as number) - (cc[cc.length - 1].v as number)) / 1000;

  const cur = tel.series.current;
  const volt = tel.series.voltage;
  if (currentSupported && voltageSupported && cur && volt) {
    // Power = voltage × current, from samples taken at the same timestamp.
    // Discharge current is negative in the raw convention; power is reported positive.
    const pairs: { t: number; w: number }[] = [];
    const vByT = new Map(volt.filter((x) => x.v !== null).map((x) => [x.t, x.v as number]));
    for (const c of cur) {
      const v = vByT.get(c.t);
      if (c.v === null || v === undefined) continue;
      pairs.push({ t: c.t, w: -(c.v / 1000) * v });
    }
    if (pairs.length > 1) {
      out.avgPowerW = pairs.reduce((a, p) => a + p.w, 0) / pairs.length;
      // Trapezoid integration; never across a gap (consecutive samples only).
      let wh = 0;
      for (let i = 1; i < pairs.length; i++) {
        const dt = pairs[i].t - pairs[i - 1].t;
        if (dt > 1000) continue;
        wh += ((pairs[i].w + pairs[i - 1].w) / 2) * (dt / 3600000);
      }
      out.energyWh = wh;
      out.powerNote = 'Whole-device battery power from synchronised voltage × current. Not game-only energy.';
    }
  } else {
    out.powerNote = currentSupported ? 'Power draw: unavailable (voltage not supported).' : 'Power draw: unavailable (battery current not supported on this device).';
  }
  return out;
}

export interface LoadTime {
  ms: number | null;
  note: string;
}

/** Load time needs explicit start and ready markers. The first screenshot is not "ready". */
export function loadTime(tel: Telemetry): LoadTime | null {
  const start = tel.events.find((e) => e.kind === 'load-start');
  if (!start) return null;
  const ready = tel.events.find((e) => e.kind === 'load-ready' && e.t > start.t);
  return ready ? { ms: ready.t - start.t, note: `${start.label} → ${ready.label}` } : { ms: null, note: 'Ready marker not observed.' };
}

export function fmtClock(ms: number, tenths = false): string {
  const neg = ms < 0;
  const a = Math.abs(ms);
  const m = Math.floor(a / 60000);
  const s = (a % 60000) / 1000;
  const sec = tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return `${neg ? '−' : ''}${String(m).padStart(2, '0')}:${sec}`;
}

/** Memory is stored in MB. 1 GB = 1024 MB. */
export const mbToGb = (mb: number) => mb / 1024;

/** p-th percentile of raw frame intervals in consecutive windows; a point per window end. Empty windows are gaps. */
export function windowedPercentile(frameT: ArrayLike<number>, frameDt: ArrayLike<number>, endMs: number, windowMs: number, p: number): { t: number; v: number | null }[] {
  const out: { t: number; v: number | null }[] = [];
  let i = 0;
  for (let a = 0; a < endMs; a += windowMs) {
    const b = Math.min(endMs, a + windowMs);
    const vals: number[] = [];
    while (i < frameT.length && frameT[i] <= b) {
      if (frameT[i] > a) vals.push(frameDt[i]);
      i++;
    }
    out.push({ t: b, v: percentile(vals, p) });
  }
  return out;
}
