import { mbToGb } from '../domain/analysis';
import { build, device, scenario } from '../domain/catalog';
import type { ConditionCheck, CompareVerdict, Delta } from '../domain/compare';
import type { Report } from '../domain/report';
import { reportKey } from '../domain/report';
import { VERDICT_LABEL, type Ruleset } from '../domain/verdict';
import type { PublicationSnapshot } from '../integrations/publication';
import type { Destination } from './fixtures';

const f1 = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? 'n/a' : v.toFixed(d));
const sgn = (v: number | null, d: number) => (v === null ? 'n/a' : `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(d)}`);

function mapProps(dest: Destination, fields: Record<string, string>) {
  return Object.fromEntries(dest.mapping.filter((m) => fields[m.field] !== undefined).map((m) => [m.property, fields[m.field]]));
}

export function reportSnapshot(r: Report, dest: Destination): PublicationSnapshot {
  const c = r.session.config;
  const b = r.battery;
  const caveats = ['Simulated demo data, not measured on a device.'];
  if (c.capture !== 'off') caveats.push('Screen capture enabled; compare matching configurations.');
  if (r.verdict.state === 'incomplete') caveats.push(r.verdict.reason);
  if (b.status === 'charging') caveats.push('External power was reported; battery discharge analysis is not valid.');
  caveats.push('One run. Repeat runs before drawing conclusions.');
  return {
    kind: 'report',
    title: `${r.title} · Performance report`,
    properties: mapProps(dest, {
      Title: r.title,
      Build: build(c.buildId)?.version ?? '',
      Device: device(c.deviceId)?.name ?? '',
      Scenario: scenario(c.scenarioId)?.name ?? '',
      Verdict: VERDICT_LABEL[r.verdict.state],
      'Average FPS': f1(r.frames?.avgFps),
      'p95 frame time': `${f1(r.frames?.p95FrameMs)} ms`,
    }),
    summary: [
      `Verdict: ${VERDICT_LABEL[r.verdict.state]}. ${r.verdict.reason}`,
      `Average frame rate ${f1(r.frames?.avgFps)} FPS; p95 frame time ${f1(r.frames?.p95FrameMs)} ms (${r.frames?.window.label ?? 'no frames'}).`,
      `Time below ${r.frames?.belowTarget.thresholdFps ?? '–'} FPS: ${f1(r.frames?.belowTarget.pct)}% of valid 1 s windows.`,
      `Peak memory (PSS): ${r.memory?.max != null ? `${r.memory.max} MB (${mbToGb(r.memory.max).toFixed(2)} GB)` : 'unavailable'}.`,
      b.status === 'ok' ? `Battery: ${b.startLevel}% → ${b.endLevel}% = ${b.dropPp} percentage points over ${b.durationMin.toFixed(0)} min (${f1(b.ppPerHour)} pp/hour, observed interval).` : `Battery: ${b.powerNote}`,
    ],
    caveats,
    charts: ['Frame rate', 'Frame time', 'Memory'],
    includeRaw: true,
    reportLink: `performance-lab-${r.session.id}.zip (local bundle; interactive charts are not embedded)`,
  };
}

export function comparisonSnapshot(a: Report, b: Report, checks: ConditionCheck[], ds: Delta[], v: CompareVerdict, dest: Destination): PublicationSnapshot {
  const va = build(a.session.config.buildId)?.version;
  const vb = build(b.session.config.buildId)?.version;
  const mismatches = checks.filter((c) => !c.match);
  return {
    kind: 'comparison',
    title: `Orbit Garden ${vb} · Performance comparison`,
    properties: mapProps(dest, {
      Title: `Orbit Garden ${vb} vs ${va}`,
      Build: vb ?? '',
      Device: device(b.session.config.deviceId)?.name ?? '',
      Scenario: scenario(b.session.config.scenarioId)?.name ?? '',
      Verdict: v.reason,
    }),
    summary: ds.map((d) => `${d.label}: ${f1(d.baseline, d.decimals)} → ${f1(d.candidate, d.decimals)} ${d.unit} (${sgn(d.delta, d.decimals)} ${d.unit})`),
    table: [['Metric', `Baseline (${va})`, `Candidate (${vb})`, 'Change'], ...ds.map((d) => [d.label, `${f1(d.baseline, d.decimals)} ${d.unit}`, `${f1(d.candidate, d.decimals)} ${d.unit}`, `${sgn(d.delta, d.decimals)} ${d.unit}`])],
    caveats: [
      'Simulated demo data, not measured on a device.',
      mismatches.length ? `Conditions differ: ${mismatches.map((m) => m.label).join(', ')}. Limitations were acknowledged.` : 'Configurations match.',
      'One run each. Differences are not statistically tested; repeat runs are recommended.',
    ],
    charts: ['Frame rate overlay', 'Frame time overlay'],
    includeRaw: true,
    reportLink: 'Comparison view (local); raw bundles attached separately',
  };
}

export const analysisKeyFor = (r: Report, rs: Ruleset) => reportKey(r.session, rs);
