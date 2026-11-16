import { alignCapture } from '../src/domain/align';
import { analysisWindow, batteryStats, belowTarget, frameStats, percentile } from '../src/domain/analysis';
import { device } from '../src/domain/catalog';
import { compareVerdict, conditionChecks, deltas } from '../src/domain/compare';
import { minMaxDecimate } from '../src/domain/downsample';
import { csvCell, escapeHtml, exportBundle, manifest } from '../src/domain/export';
import { canTransition, transition } from '../src/domain/lifecycle';
import { combinationProblems, readiness } from '../src/domain/readiness';
import { buildReport } from '../src/domain/report';
import { simulate } from '../src/domain/simulate';
import type { Capture, Session, Telemetry } from '../src/domain/types';
import { evaluate } from '../src/domain/verdict';
import { unzip } from '../src/domain/zip';
import { config, fixtureSessions, RULESET, sim } from '../src/data/fixtures';

const fx = (id: string) => fixtureSessions().find((s) => s.id === id)!;
const phone = device('dev-phone')!;

function session(over: Partial<Session> = {}): Session {
  return {
    id: 't',
    name: 'test',
    config: config({}),
    sim: sim({}),
    seed: 1,
    state: 'complete',
    endReason: 'completed',
    createdAt: '2026-11-16T00:00:00.000Z',
    recordedMs: 1_200_000,
    annotations: [],
    collectorVersions: {},
    fixture: true,
    ...over,
  };
}

describe('battery', () => {
  it('80% → 72% over 20 minutes is 8 pp and 24 pp/hour', () => {
    const s = session();
    const b = batteryStats(s, simulate(s, phone), false, true, false);
    expect(b.startLevel).toBe(80);
    expect(b.endLevel).toBe(72);
    expect(b.dropPp).toBe(8);
    expect(b.ppPerHour).toBeCloseTo(24, 5);
  });

  it('unsupported current is unavailable, never zero power', () => {
    const s = session();
    const b = batteryStats(s, simulate(s, phone), false, true, false);
    expect(b.avgPowerW).toBeNull();
    expect(b.energyWh).toBeNull();
    expect(b.chargeConsumedMah).toBeNull();
    expect(b.powerNote).toMatch(/unavailable/);
  });

  it('a charging interval invalidates discharge analysis', () => {
    const s = session({ sim: sim({ chargingSec: [[300, 420]] }) });
    const b = batteryStats(s, simulate(s, phone), false, true, false);
    expect(b.status).toBe('charging');
    expect(b.dropPp).toBeNull();
    expect(b.ppPerHour).toBeNull();
  });

  it('power is volts × amps and energy integrates over time', () => {
    const r = buildReport(fx('ses-084-tablet'), RULESET);
    expect(r.battery.avgPowerW).toBeGreaterThan(1.5);
    expect(r.battery.avgPowerW).toBeLessThan(3.5);
    // Energy ≈ average power × duration.
    expect(r.battery.energyWh!).toBeCloseTo(r.battery.avgPowerW! * (900 / 3600), 1);
    expect(r.battery.chargeConsumedMah).toBeGreaterThan(0);
  });
});

describe('frame statistics', () => {
  const tel = (dts: number[], gaps: Telemetry['gaps'] = []): Telemetry => {
    let t = 0;
    const ts = dts.map((d) => (t += d));
    return { frameT: Float64Array.from(ts), frameDt: Float64Array.from(dts), series: {}, charging: [], captures: [], events: [], gaps, endMs: t };
  };

  it('nearest-rank percentiles on raw intervals', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile(values, 50)).toBe(50);
    expect(percentile([], 95)).toBeNull();
  });

  it('average FPS = frames ÷ valid seconds, excluding warm-up and gaps', () => {
    const dts = Array(600).fill(1000 / 60); // 10 s at 60 FPS
    const s = session({ config: config({ warmupSec: 2, durationSec: 10 }), recordedMs: 10_000 });
    const t = tel(dts, [{ fromMs: 4000, toMs: 6000, stream: 'telemetry' }]);
    // Frames inside the gap are not eligible.
    const frameT = Array.from(t.frameT).filter((x) => x < 4000 || x >= 6000);
    const filtered = { ...t, frameT: Float64Array.from(frameT), frameDt: Float64Array.from(frameT.map(() => 1000 / 60)) };
    const f = frameStats(s, filtered, 54, analysisWindow(s));
    expect(f.window.fromMs).toBe(2000);
    expect(f.validSeconds).toBeCloseTo(6, 5);
    expect(f.avgFps).toBeCloseTo(60, 0);
    expect(f.coverage).toBeCloseTo(0.75, 5);
  });

  it('p95 frame time is not the reciprocal of average FPS', () => {
    const dts = [...Array(90).fill(16), ...Array(10).fill(50)];
    const s = session({ config: config({ warmupSec: 0 }), recordedMs: dts.reduce((a, b) => a + b, 0) });
    const f = frameStats(s, tel(dts), 54);
    expect(f.p95FrameMs).toBe(50);
    expect(1000 / f.avgFps!).not.toBeCloseTo(f.p95FrameMs!, 0);
    expect(f.slowFrames).toBe(10);
  });

  it('below target excludes windows without data instead of counting them as zero', () => {
    const fps = [
      { t: 1000, v: 60 },
      { t: 2000, v: 50 },
      { t: 3000, v: null },
      { t: 4000, v: 60 },
    ];
    const b = belowTarget(fps, 54, { fromMs: 0, toMs: 4000 });
    expect(b.windowsEvaluated).toBe(3);
    expect(b.windowsBelow).toBe(1);
    expect(b.pct).toBeCloseTo(33.33, 1);
  });

  it('chart decimation keeps spikes and cannot change report numbers', () => {
    const r = buildReport(fx('ses-084'), RULESET);
    const before = r.frames!.p95FrameMs;
    const pts = minMaxDecimate(r.tel.frameT, r.tel.frameDt, 0, r.tel.endMs, 200);
    const maxShown = Math.max(...pts.filter((p) => p.v !== null).map((p) => p.v as number));
    expect(maxShown).toBeCloseTo(Math.max(...r.tel.frameDt), 6);
    expect(pts.length).toBeLessThan(r.tel.frameDt.length / 50);
    expect(buildReport(fx('ses-084'), RULESET).frames!.p95FrameMs).toBe(before);
  });
});

describe('simulation', () => {
  it('is deterministic and prefix-stable (a shorter recording is the start of a longer one)', () => {
    const s = fx('ses-084');
    const short = simulate(s, phone, 300_000);
    const long = simulate(s, phone, 600_000);
    expect(Array.from(short.frameT)).toEqual(Array.from(long.frameT.slice(0, short.frameT.length)));
    expect(short.series.memory).toEqual(long.series.memory!.slice(0, short.series.memory!.length));
    expect(short.captures).toEqual(long.captures.slice(0, short.captures.length));
  });

  it('gaps produce missing values, never interpolated ones', () => {
    const r = buildReport(fx('ses-084-gaps'), RULESET);
    const inGap = r.tel.series.fps!.filter((x) => x.t > 300_000 && x.t <= 330_000);
    expect(inGap.length).toBeGreaterThan(0);
    expect(inGap.every((x) => x.v === null)).toBe(true);
    expect(r.tel.frameT.some((t) => t > 300_000 && t < 330_000)).toBe(false);
    expect(r.tel.series.temperature).toBeUndefined();
    expect(r.availability.temperature).toBe('denied');
  });

  it('actual capture intervals are recorded, not the requested ones', () => {
    const r = buildReport(fx('ses-084'), RULESET);
    const intervals = r.tel.captures.slice(1, 50).map((c, i) => c.t - r.tel.captures[i].t);
    expect(intervals.some((d) => d !== 2000)).toBe(true);
    expect(Math.min(...intervals)).toBeGreaterThanOrEqual(2000);
  });
});

describe('alignment', () => {
  const caps: Capture[] = [12_320_0, 12_336_0, 12_350_0].map((x, i) => ({ index: i, t: x / 10, scene: 'garden', level: 4 }));
  it('selecting 12:34 picks the capture at 12:33.6 with offset −0.4 s', () => {
    const a = alignCapture(
      [732_000, 753_600, 755_000].map((t, i) => ({ index: i, t, scene: 'garden' as const, level: 4 })),
      [],
      754_000,
    );
    expect(a.kind).toBe('match');
    if (a.kind === 'match') {
      expect(a.capture.t).toBe(753_600);
      expect(a.offsetMs).toBe(-400);
    }
  });
  it('outside tolerance shows no capture rather than a distant one', () => {
    const a = alignCapture(caps, [], 1_300_000);
    expect(a.kind).toBe('none');
  });
  it('inside a capture gap the reason is the gap', () => {
    const r = buildReport(fx('ses-084-gaps'), RULESET);
    const a = alignCapture(r.tel.captures, r.tel.gaps, 520_000);
    expect(a).toMatchObject({ kind: 'none', reason: 'capture-gap' });
  });
});

describe('verdicts', () => {
  it('flags the 0.8.4 regression with the exact failing rule', () => {
    const v = buildReport(fx('ses-084'), RULESET).verdict;
    expect(v.state).toBe('review');
    const p95 = v.rules.find((r) => r.id === 'p95-frame')!;
    expect(p95.status).toBe('fail');
    expect(p95.observed).toBeGreaterThan(RULESET.maxP95FrameMs);
  });
  it('interrupted and bot-failed runs are incomplete, never passed', () => {
    expect(buildReport(fx('ses-084-int'), RULESET).verdict.state).toBe('incomplete');
    expect(buildReport(fx('ses-084-botfail'), RULESET).verdict.state).toBe('incomplete');
  });
  it('missing metrics are not evaluated rather than passed', () => {
    const s = session();
    const v = evaluate(s, null, null, RULESET);
    expect(v.state).toBe('not-evaluated');
  });
  it('cancelled sessions are not benchmarks', () => {
    expect(evaluate(session({ state: 'cancelled', endReason: 'cancelled' }), null, null, RULESET).state).toBe('not-evaluated');
  });
});

describe('comparison', () => {
  it('matching runs give signed, unit-correct deltas', () => {
    const a = buildReport(fx('ses-083'), RULESET);
    const b = buildReport(fx('ses-084'), RULESET);
    const checks = conditionChecks(a, b);
    expect(checks.every((c) => c.match)).toBe(true);
    const ds = deltas(a, b, RULESET);
    const p95 = ds.find((d) => d.id === 'p95')!;
    expect(p95.delta).toBeCloseTo(b.frames!.p95FrameMs! - a.frames!.p95FrameMs!, 6);
    expect(p95.exceeds).toBe(true);
    expect(ds.find((d) => d.id === 'battery')!.delta).toBe(1);
    expect(compareVerdict(checks, ds, false).state).toBe('review');
  });
  it('incompatible conditions block the verdict until acknowledged', () => {
    const a = buildReport(fx('ses-083'), RULESET);
    const b = buildReport(fx('ses-084-gaps'), RULESET);
    const checks = conditionChecks(a, b);
    expect(checks.find((c) => c.label === 'Connection')!.match).toBe(false);
    const ds = deltas(a, b, RULESET);
    expect(compareVerdict(checks, ds, false).state).toBe('blocked');
    expect(compareVerdict(checks, ds, true).state).toMatch(/^acknowledged/);
  });
});

describe('setup and lifecycle', () => {
  it('connection, play mode and capture are independent but limited by the device profile', () => {
    expect(combinationProblems(config({ connection: 'wireless', capture: 'video' }))).toEqual([expect.stringMatching(/Video is not supported over wireless/)]);
    expect(combinationProblems(config({ connection: 'usb', capture: 'video', playMode: 'bot', botScriptId: 'bot-harvest' }))).toEqual([]);
    expect(combinationProblems(config({ deviceId: 'dev-ios', connection: 'usb', capture: 'off' }))[0]).toMatch(/no collector/);
  });
  it('readiness reports unsupported metrics and invalid bot scripts', () => {
    const checks = readiness(config({ metrics: ['fps', 'gpu'], playMode: 'bot', botScriptId: 'bot-harvest', buildId: 'og-084' }));
    expect(checks.find((c) => c.id === 'collectors')!.status).toBe('warn');
    expect(checks.find((c) => c.id === 'bot')!.status).toBe('pass');
  });
  it('rejects invalid transitions and never resumes a terminal state', () => {
    expect(canTransition('recording', 'stopping')).toBe(true);
    expect(canTransition('interrupted', 'recording')).toBe(false);
    expect(() => transition(session({ state: 'complete' }), 'recording')).toThrow();
  });
});

describe('exports', () => {
  it('neutralises spreadsheet formulas and escapes HTML', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell(-3)).toBe('-3');
    expect(escapeHtml('<img onerror=x>')).toBe('&lt;img onerror=x&gt;');
  });
  it('bundle reopens with units, sources, caveats and relative evidence', () => {
    const s = fx('ses-084');
    s.annotations.push({ id: 'x', t: 1000, text: '=cmd|calc', createdAt: '' });
    const r = buildReport(s, RULESET);
    const files = unzip(exportBundle(r).bytes);
    const m = JSON.parse(files['manifest.json']);
    expect(m.simulated).toBe(true);
    expect(m.metrics.memory.unit).toBe('MB');
    expect(m.metrics.temperature.scope).toBe('battery sensor');
    expect(files['streams/telemetry.csv'].split('\n')[0]).toBe('t_ms,t_s,metric,value,unit,scope,source,aggregation');
    expect(files['streams/events.csv']).toContain(`'=cmd|calc`);
    const firstCapture = m.files.captures[0].file;
    expect(files[firstCapture]).toMatch(/^<svg/);
    expect(files['report.html']).toContain(`src="${firstCapture}"`);
    expect(files['report.html']).toContain('Simulated data');
    expect(manifest(r).verdict.state).toBe('review');
  });
});
