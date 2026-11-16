import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtClock } from '../domain/analysis';
import type { Point } from '../domain/downsample';
import type { Gap } from '../domain/types';

export interface ChartSeries {
  id: string;
  label: string;
  color: string;
  points: Point[];
  dashed?: boolean;
}

export interface TimeChartProps {
  title: string;
  unit: string;
  series: ChartSeries[];
  /** Right edge of the time axis. */
  axisEndMs: number;
  /** Data never extends past this time (e.g. "now" while recording). */
  dataEndMs?: number;
  cursor: number | null;
  onCursor?: (t: number | null, commit: boolean) => void;
  warmupMs?: number;
  gaps?: Gap[];
  markers?: { t: number; label: string }[];
  threshold?: { v: number; label: string };
  yMin?: number;
  yMax?: number;
  height?: number;
  /** Text for the value(s) at time t, used by the tooltip and screen readers. */
  describe?: (t: number) => string;
  note?: string;
}

const M = { l: 46, r: 12, t: 8, b: 22 };

function niceStep(span: number, target: number) {
  const raw = span / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

const TIME_STEPS = [10_000, 30_000, 60_000, 120_000, 300_000, 600_000, 1_200_000];

export function TimeChart(p: TimeChartProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const height = p.height ?? 150;
  const titleId = useId();
  useEffect(() => {
    const el = wrap.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setWidth(Math.max(240, Math.floor(entries[0].contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const values = p.series.flatMap((s) => s.points.filter((x) => x.v !== null).map((x) => x.v as number));
  let lo = p.yMin ?? (values.length ? Math.min(...values) : 0);
  let hi = p.yMax ?? (values.length ? Math.max(...values) : 1);
  if (p.threshold && p.yMax === undefined) hi = Math.max(hi, p.threshold.v);
  if (hi - lo < 1e-9) hi = lo + 1;
  const yStep = niceStep(hi - lo, 4);
  if (p.yMin === undefined) lo = Math.floor(lo / yStep) * yStep;
  if (p.yMax === undefined) hi = Math.ceil(hi / yStep) * yStep;
  const plotW = width - M.l - M.r;
  const plotH = height - M.t - M.b;
  const end = Math.max(1, p.axisEndMs);
  const x = (t: number) => M.l + (t / end) * plotW;
  const y = (v: number) => M.t + plotH - ((v - lo) / (hi - lo)) * plotH;
  const tFromX = (px: number) => Math.max(0, Math.min(p.dataEndMs ?? end, ((px - M.l) / plotW) * end));

  const yTicks: number[] = [];
  for (let v = lo; v <= hi + yStep * 1e-6; v += yStep) yTicks.push(Math.round(v * 1000) / 1000);
  const tStep = TIME_STEPS.find((s) => end / s <= 8) ?? 1_200_000;
  const xTicks: number[] = [];
  for (let t = 0; t <= end + 1; t += tStep) xTicks.push(t);

  const pathFor = (pts: Point[]) => {
    let d = '';
    let pen = false;
    for (const pt of pts) {
      if (pt.v === null || pt.t > (p.dataEndMs ?? Infinity)) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${x(pt.t).toFixed(1)},${y(Math.max(lo, Math.min(hi, pt.v))).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    p.onCursor?.(tFromX(((e.clientX - r.left) / r.width) * width), false);
  };
  const onClick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    p.onCursor?.(tFromX(((e.clientX - r.left) / r.width) * width), true);
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!p.onCursor) return;
    const max = p.dataEndMs ?? end;
    const cur = p.cursor ?? 0;
    const step = e.shiftKey ? 10_000 : 1_000;
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = cur + step;
    else if (e.key === 'ArrowLeft') next = cur - step;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = max;
    if (next === null) return;
    e.preventDefault();
    p.onCursor(Math.max(0, Math.min(max, next)), true);
  };

  const cursorX = p.cursor !== null ? x(p.cursor) : null;
  const desc = p.cursor !== null && p.describe ? p.describe(p.cursor) : '';
  const nowMs = p.dataEndMs;
  return (
    <div className="chart" ref={wrap}>
      <div className="chart-head">
        <h3 id={titleId}>
          {p.series.length === 1 && <span className="swatch" style={{ background: p.series[0].color }} aria-hidden />}
          {p.title} <span className="subtle">({p.unit})</span>
        </h3>
        {p.series.length > 1 ? (
          <div className="legend">
            {p.series.map((s) => (
              <span key={s.id}>
                <svg width="22" height="6" aria-hidden>
                  <line x1="0" y1="3" x2="22" y2="3" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dashed ? '5 3' : undefined} />
                </svg>
                {s.label}
              </span>
            ))}
          </div>
        ) : (
          p.note && <span className="subtle">{p.note}</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        height={height}
        role="slider"
        tabIndex={p.onCursor ? 0 : -1}
        aria-labelledby={titleId}
        aria-valuemin={0}
        aria-valuemax={Math.round((p.dataEndMs ?? end) / 1000)}
        aria-valuenow={p.cursor !== null ? Math.round(p.cursor / 1000) : 0}
        aria-valuetext={p.cursor !== null ? `${fmtClock(p.cursor, true)}${desc ? `, ${desc}` : ''}` : 'No time selected. Use arrow keys to move through the session.'}
        onPointerMove={onMove}
        onPointerLeave={() => p.onCursor?.(null, false)}
        onClick={onClick}
        onKeyDown={onKey}
      >
        <defs>
          <pattern id={`${titleId}-hatch`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="#3b4959" strokeWidth="2" />
          </pattern>
        </defs>
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={M.l} x2={width - M.r} y1={y(v)} y2={y(v)} stroke="#26313d" />
            <text x={M.l - 6} y={y(v) + 4} fontSize="11" fill="#8c9cab" textAnchor="end">
              {Math.abs(v) >= 10000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : v}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <text key={t} x={x(t)} y={height - 5} fontSize="11" fill="#8c9cab" textAnchor={t === 0 ? 'start' : 'middle'}>
            {fmtClock(t)}
          </text>
        ))}
        {!!p.warmupMs && (
          <g>
            <rect x={x(0)} y={M.t} width={x(Math.min(p.warmupMs, end)) - x(0)} height={plotH} fill="#ffffff" opacity="0.04" />
            <text x={x(0) + 4} y={M.t + 12} fontSize="10" fill="#8c9cab">
              warm-up (excluded)
            </text>
          </g>
        )}
        {p.gaps?.map((g, i) => (
          <g key={i}>
            <rect x={x(g.fromMs)} y={M.t} width={Math.max(2, x(g.toMs) - x(g.fromMs))} height={plotH} fill={`url(#${titleId}-hatch)`} opacity={g.stream === 'telemetry' ? 0.9 : 0.4} />
            <title>{`${g.stream === 'telemetry' ? 'No telemetry' : 'No captures'} ${fmtClock(g.fromMs)}–${fmtClock(g.toMs)}`}</title>
          </g>
        ))}
        {nowMs !== undefined && nowMs < end && (
          <g>
            <rect x={x(nowMs)} y={M.t} width={x(end) - x(nowMs)} height={plotH} fill="#0d1218" opacity="0.55" />
            <text x={(x(nowMs) + x(end)) / 2} y={M.t + plotH / 2} fontSize="11" fill="#8c9cab" textAnchor="middle">
              not recorded yet
            </text>
          </g>
        )}
        {p.threshold && p.threshold.v >= lo && p.threshold.v <= hi && (
          <g>
            <line x1={M.l} x2={width - M.r} y1={y(p.threshold.v)} y2={y(p.threshold.v)} stroke="#b2bfcb" strokeDasharray="4 4" strokeWidth="1" />
            <text x={width - M.r - 2} y={y(p.threshold.v) + 13} fontSize="10.5" fill="#b2bfcb" textAnchor="end" paintOrder="stroke" stroke="#1b242e" strokeWidth="3">
              {p.threshold.label}
            </text>
          </g>
        )}
        {p.series.map((s) => (
          <path key={s.id} d={pathFor(s.points)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeDasharray={s.dashed ? '6 4' : undefined} />
        ))}
        {p.markers?.map((m, i) => (
          <g key={i}>
            <line x1={x(m.t)} x2={x(m.t)} y1={M.t} y2={M.t + plotH} stroke="#f2c46b" strokeWidth="1" strokeDasharray="2 3" />
            <path d={`M${x(m.t) - 4},${M.t} h8 v7 l-4,-3 l-4,3z`} fill="#f2c46b" />
            <title>{`${fmtClock(m.t, true)} ${m.label}`}</title>
          </g>
        ))}
        {cursorX !== null && <line x1={cursorX} x2={cursorX} y1={M.t} y2={M.t + plotH} stroke="#e8eef3" strokeWidth="1.5" />}
        <rect x={M.l} y={M.t} width={plotW} height={plotH} fill="transparent" />
      </svg>
      {cursorX !== null && desc && (
        <div className={`tip ${cursorX > width * 0.65 ? 'flip' : ''}`} style={{ left: `${(cursorX / width) * 100}%` }} aria-hidden>
          <strong>{fmtClock(p.cursor!, true)}</strong> · {desc}
        </div>
      )}
    </div>
  );
}
