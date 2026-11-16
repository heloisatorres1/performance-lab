import { useMemo, useState } from 'react';
import { frameAt, sampleAt } from '../domain/align';
import { fmtClock, percentile } from '../domain/analysis';
import { METRICS } from '../domain/catalog';
import { minMaxDecimate, type Point } from '../domain/downsample';
import type { Availability, MetricId, Telemetry } from '../domain/types';
import type { Ruleset } from '../domain/verdict';
import { TimeChart } from './TimeChart';
import { AvailabilityBadge } from './ui';

export type ChartId = 'fps' | 'frameTime' | 'memory' | 'temperature' | 'cpu' | 'battery';

export const CHART_COLOR: Record<ChartId, string> = {
  fps: 'var(--m-fps)',
  frameTime: 'var(--m-frame)',
  memory: 'var(--m-mem)',
  temperature: 'var(--m-temp)',
  cpu: 'var(--m-cpu)',
  battery: 'var(--m-battery)',
};

interface Props {
  tel: Telemetry;
  /** Session time that bounds the visible data (recorded length, or "now" while live). */
  dataEndMs: number;
  axisEndMs: number;
  availability: Record<MetricId, Availability>;
  captured: MetricId[];
  ruleset: Ruleset;
  targetFps: number;
  warmupMs?: number;
  cursor: number | null;
  onCursor: (t: number | null, commit: boolean) => void;
  markers: { t: number; label: string }[];
  initial: ChartId[];
  compact?: boolean;
}

const pts = (samples: { t: number; v: number | null }[] | undefined, end: number): Point[] => (samples ?? []).filter((x) => x.t <= end);

export function SessionCharts(p: Props) {
  const [shown, setShown] = useState<ChartId[]>(p.initial);
  const end = p.dataEndMs;
  const frameIdx = useMemo(() => {
    let lo = 0;
    let hi = p.tel.frameT.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (p.tel.frameT[mid] <= end) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }, [p.tel, end]);
  const frameT = useMemo(() => p.tel.frameT.subarray(0, frameIdx), [p.tel, frameIdx]);
  const frameDt = useMemo(() => p.tel.frameDt.subarray(0, frameIdx), [p.tel, frameIdx]);
  const framePts = useMemo(() => minMaxDecimate(frameT, frameDt, 0, p.axisEndMs, 400), [frameT, frameDt, p.axisEndMs]);
  const gaps = p.tel.gaps.filter((g) => g.fromMs <= end);

  const value = (m: MetricId, t: number, d = 1, unit = METRICS[m].unit) => {
    const s = sampleAt(p.tel.series[m], t);
    if (!s || s.t > end) return 'no sample';
    return s.v === null ? 'gap (no data)' : `${s.v.toFixed(d)} ${unit}`;
  };
  const charts: Record<ChartId, { metric: MetricId; el: () => React.ReactNode }> = {
    fps: {
      metric: 'fps',
      el: () => (
        <TimeChart
          title="Frame rate"
          unit="FPS, 1 s windows"
          series={[{ id: 'fps', label: 'FPS', color: CHART_COLOR.fps, points: pts(p.tel.series.fps, end) }]}
          yMin={0}
          yMax={Math.max(70, p.targetFps + 10)}
          threshold={{ v: p.ruleset.belowTargetFps, label: `below-target threshold ${p.ruleset.belowTargetFps} FPS` }}
          describe={(t) => value('fps', t, 0, 'FPS')}
          {...common}
        />
      ),
    },
    frameTime: {
      metric: 'frameTime',
      el: () => (
        <TimeChart
          title="Frame time"
          unit="ms per frame"
          note="min/max per pixel, spikes kept"
          series={[{ id: 'ft', label: 'Frame time', color: CHART_COLOR.frameTime, points: framePts }]}
          yMin={0}
          threshold={{ v: p.ruleset.maxP95FrameMs, label: `p95 limit ${p.ruleset.maxP95FrameMs} ms` }}
          describe={(t) => {
            const f = frameAt(frameT, frameDt, t);
            return f ? `${f.dt.toFixed(1)} ms (frame at ${fmtClock(f.t, true)})` : 'no frame';
          }}
          {...common}
        />
      ),
    },
    memory: {
      metric: 'memory',
      el: () => (
        <TimeChart
          title="Memory (PSS, game process)"
          unit="MB; 1 GB = 1024 MB"
          series={[{ id: 'mem', label: 'Memory', color: CHART_COLOR.memory, points: pts(p.tel.series.memory, end) }]}
          describe={(t) => value('memory', t, 0)}
          {...common}
        />
      ),
    },
    temperature: {
      metric: 'temperature',
      el: () => (
        <TimeChart
          title="Battery temperature (sensor)"
          unit="°C"
          series={[{ id: 'temp', label: 'Battery temperature', color: CHART_COLOR.temperature, points: pts(p.tel.series.temperature, end) }]}
          describe={(t) => value('temperature', t, 1)}
          {...common}
        />
      ),
    },
    cpu: {
      metric: 'cpu',
      el: () => (
        <TimeChart
          title="CPU (system-wide)"
          unit="%, 100% = all cores"
          series={[{ id: 'cpu', label: 'CPU', color: CHART_COLOR.cpu, points: pts(p.tel.series.cpu, end) }]}
          yMin={0}
          yMax={100}
          describe={(t) => value('cpu', t, 0)}
          {...common}
        />
      ),
    },
    battery: {
      metric: 'battery',
      el: () => (
        <TimeChart
          title="Battery level"
          unit="%, 1% granularity"
          series={[{ id: 'bat', label: 'Battery', color: CHART_COLOR.battery, points: pts(p.tel.series.battery, end) }]}
          describe={(t) => value('battery', t, 0)}
          {...common}
        />
      ),
    },
  };
  // Shared props for every chart: one timeline, one cursor.
  const common = {
    axisEndMs: p.axisEndMs,
    dataEndMs: end,
    cursor: p.cursor,
    onCursor: p.onCursor,
    warmupMs: p.warmupMs,
    gaps,
    markers: p.markers,
    height: p.compact ? 120 : 140,
  };
  const ids = Object.keys(charts) as ChartId[];
  const isOn = (id: ChartId) => (id === 'frameTime' ? p.captured.includes('frameTime') || p.captured.includes('fps') : p.captured.includes(charts[id].metric));

  return (
    <div className="stack">
      <div className="chips" role="group" aria-label="Charts to show">
        {ids.map((id) => (
          <label key={id} className="chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={shown.includes(id)} onChange={(e) => setShown((v) => (e.target.checked ? [...v, id] : v.filter((x) => x !== id)))} />
            <span className="swatch" style={{ background: CHART_COLOR[id] }} aria-hidden /> {METRICS[charts[id].metric].label}
          </label>
        ))}
      </div>
      <div className="chart-stack">
        {ids
          .filter((id) => shown.includes(id))
          .map((id) =>
            isOn(id) ? (
              <div key={id}>{charts[id].el()}</div>
            ) : (
              <div key={id} className="row callout">
                <strong>{METRICS[charts[id].metric].label}</strong> <AvailabilityBadge a={p.availability[charts[id].metric]} />
                <span className="subtle">{p.availability[charts[id].metric] === 'supported' ? 'Not selected for this session.' : 'Not recorded. Missing data is not shown as zero.'}</span>
              </div>
            ),
          )}
      </div>
      <p className="hint">
        Hover to inspect, click to select a time. With a chart focused, <kbd>←</kbd> <kbd>→</kbd> move 1 s, <kbd>Shift</kbd> moves 10 s. Hatched areas have no data.
      </p>
      <DataTable tel={p.tel} end={end} />
    </div>
  );
}

/** Accessible alternative to the charts: 30 s buckets computed from raw data. */
function DataTable({ tel, end }: { tel: Telemetry; end: number }) {
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    if (!open) return [];
    const out: { from: number; to: number; fps: string; p95: string; mem: string; temp: string; bat: string }[] = [];
    const bucket = 30_000;
    const avg = (m: MetricId, a: number, b: number, d = 1) => {
      const v = (tel.series[m] ?? []).filter((x) => x.t > a && x.t <= b && x.v !== null).map((x) => x.v as number);
      return v.length ? (v.reduce((s, x) => s + x, 0) / v.length).toFixed(d) : '–';
    };
    for (let a = 0; a < end; a += bucket) {
      const b = Math.min(end, a + bucket);
      const dts: number[] = [];
      for (let i = 0; i < tel.frameT.length; i++) if (tel.frameT[i] > a && tel.frameT[i] <= b) dts.push(tel.frameDt[i]);
      const p95 = percentile(dts, 95);
      out.push({ from: a, to: b, fps: avg('fps', a, b), p95: p95 === null ? '–' : p95.toFixed(1), mem: avg('memory', a, b, 0), temp: avg('temperature', a, b), bat: avg('battery', a, b, 0) });
    }
    return out;
  }, [open, tel, end]);
  return (
    <details onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Show data table (30 s intervals)</summary>
      {open && (
        <div className="table-wrap" style={{ maxHeight: 360, marginTop: 8 }}>
          <table>
            <caption className="sr-only">Session data in 30 second intervals, computed from raw samples</caption>
            <thead>
              <tr><th>Interval</th><th className="r">Avg FPS</th><th className="r">p95 frame (ms)</th><th className="r">Memory (MB)</th><th className="r">Battery temp (°C)</th><th className="r">Battery (%)</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.from}>
                  <td className="num">{fmtClock(r.from)}–{fmtClock(r.to)}</td>
                  <td className="r num">{r.fps}</td>
                  <td className="r num">{r.p95}</td>
                  <td className="r num">{r.mem}</td>
                  <td className="r num">{r.temp}</td>
                  <td className="r num">{r.bat}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
