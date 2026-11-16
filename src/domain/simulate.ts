import type { Capture, DeviceProfile, Gap, MetricId, Sample, Session, Telemetry, TimelineEvent } from './types';
import { botScript, scenario } from './catalog';

// Deterministic, seeded stand-in for a collector. It produces the same data
// for the same session every time, so reports are reproducible. It is clearly
// a simulation: nothing here reads a real device.

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number) {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function availability(session: Session, dev: DeviceProfile, m: MetricId) {
  if (session.sim.deniedMetrics?.includes(m)) return 'denied' as const;
  return dev.metrics[m];
}

/** Which metrics produce a stream: selected by the user and available on the device. */
export function activeMetrics(session: Session, dev: DeviceProfile): MetricId[] {
  const sel = new Set(session.config.metrics);
  if (sel.has('battery')) ['current', 'voltage', 'chargeCounter'].forEach((m) => sel.add(m as MetricId));
  return [...sel].filter((m) => availability(session, dev, m) === 'supported');
}

export function simulate(session: Session, dev: DeviceProfile, untilMs: number = session.recordedMs): Telemetry {
  const { config: c, sim } = session;
  const endMs = Math.max(0, Math.floor(untilMs));
  // Separate generators per stream keep every stream prefix-stable: a shorter
  // recording yields exactly the first part of a longer one.
  const rng = mulberry32(session.seed);
  const rngTel = mulberry32(session.seed ^ 0x9e3779b9);
  const rngCap = mulberry32(session.seed + 0x51ed27);
  const metrics = new Set(activeMetrics(session, dev));
  const plannedMs = c.durationSec * 1000;

  const gaps: Gap[] = [];
  for (const [a, b] of sim.gapsSec ?? []) if (a * 1000 < endMs) gaps.push({ fromMs: a * 1000, toMs: Math.min(b * 1000, endMs), stream: 'telemetry' });
  for (const [a, b] of sim.captureGapsSec ?? []) if (a * 1000 < endMs && c.capture !== 'off') gaps.push({ fromMs: a * 1000, toMs: Math.min(b * 1000, endMs), stream: 'capture' });
  const telemetryGaps = gaps.filter((g) => g.stream === 'telemetry');
  const inGap = (t: number, list: Gap[] = telemetryGaps) => list.some((g) => t >= g.fromMs && t < g.toMs);
  const overlapsGap = (a: number, b: number) => telemetryGaps.some((g) => a < g.toMs && b > g.fromMs);
  const charging = (t: number) => (sim.chargingSec ?? []).some(([a, b]) => t >= a * 1000 && t < b * 1000);
  const spikeAt = (t: number) => sim.spikes.find((s) => t >= s.atSec * 1000 && t < (s.atSec + s.durSec) * 1000);
  const warmth = (t: number) => sim.tempRiseC * (1 - Math.exp(-t / 420000));

  // Frames: presentation timestamps from the simulated frame source.
  const frameT: number[] = [];
  const frameDt: number[] = [];
  let t = 0;
  let prev = 0;
  let prevValid = false;
  while (t < endMs) {
    const sp = spikeAt(t);
    let dt = sim.baseFrameMs + gaussian(rng) * 0.35;
    const hitch = sim.hitchRate * (1 + warmth(t) / 20);
    if (rng() < hitch) dt += sim.baseFrameMs * (0.3 + rng() * 1.1) * (rng() < 0.9 ? 1 : 2);
    if (sp) {
      const phase = (t - sp.atSec * 1000) / (sp.durSec * 1000);
      dt += sp.extraMs * Math.sin(Math.PI * phase) * (0.75 + rng() * 0.5);
    }
    if (sim.botFailAtSec !== undefined && t >= sim.botFailAtSec * 1000) break;
    t += Math.max(4, dt);
    if (t >= endMs) break;
    const valid = !inGap(t);
    if (valid && prevValid && !overlapsGap(prev, t)) {
      frameT.push(t);
      frameDt.push(t - prev);
    }
    prev = t;
    prevValid = valid;
  }

  // 1 Hz telemetry. A sample at t covers the window (t − 1 s, t].
  const series: Partial<Record<MetricId, Sample[]>> = {};
  for (const m of metrics) if (m !== 'frameTime') series[m] = [];
  const chargingStates: { t: number; charging: boolean }[] = [];
  let fi = 0;
  let chargeUah = (sim.batteryStart / 100) * 5000 * 1000;
  for (let s = 1; s * 1000 <= endMs; s++) {
    const ts = s * 1000;
    const gap = overlapsGap(ts - 1000, ts);
    let frames = 0;
    while (fi < frameT.length && frameT[fi] <= ts) {
      if (frameT[fi] > ts - 1000) frames++;
      fi++;
    }
    const load = spikeAt(ts) ? 1 : 0;
    const isCharging = charging(ts);
    chargingStates.push({ t: ts, charging: isCharging });
    const minutes = ts / 60000;
    const push = (m: MetricId, v: number) => series[m]?.push({ t: ts, v: gap ? null : v });
    push('fps', frames);
    push('cpu', Math.min(100, 31 + 14 * load + warmth(ts) * 0.6 + gaussian(rngTel) * 2.2));
    push('gpu', Math.min(100, 46 + 18 * load + gaussian(rngTel) * 3));
    push('memory', Math.round(sim.memStartMb + sim.memGrowMbPerMin * minutes + 22 * Math.sin(ts / 41000) + (load ? 38 : 0)));
    push('temperature', Math.round((sim.tempStartC + warmth(ts) + gaussian(rngTel) * 0.08) * 10) / 10);
    const frac = Math.min(1, ts / plannedMs);
    const level = isCharging ? Math.min(100, sim.batteryStart + Math.floor(ts / 180000)) : Math.round(sim.batteryStart - (sim.batteryStart - sim.batteryEnd) * frac);
    push('battery', level);
    const currentMa = isCharging ? 920 + gaussian(rngTel) * 25 : -(560 + 160 * load + warmth(ts) * 12 + gaussian(rngTel) * 30);
    push('current', Math.round(currentMa));
    push('voltage', Math.round((3.86 - 0.0025 * minutes + gaussian(rngTel) * 0.004) * 1000) / 1000);
    chargeUah += (currentMa * 1000) / 3600;
    push('chargeCounter', Math.round(chargeUah));
  }

  // Captures: requested interval is not a guarantee; actual times jitter.
  const captures: Capture[] = [];
  const captureGaps = gaps.filter((g) => g.stream === 'capture');
  const sceneChanges = sim.spikes.filter((s) => /scene/i.test(s.label)).map((s) => s.atSec * 1000);
  const sceneAt = (ts: number): Capture['scene'] => {
    if (sim.loadReadySec !== undefined && ts < (2 + sim.loadReadySec) * 1000) return 'loading';
    return sceneChanges.filter((x) => x <= ts).length % 2 ? 'greenhouse' : 'garden';
  };
  if (c.capture !== 'off') {
    const step = c.capture === 'video' ? 100 : c.captureIntervalSec * 1000;
    const jitter = c.capture === 'video' ? 0 : 420;
    let ct = step + rngCap() * jitter;
    let idx = 0;
    while (ct < endMs) {
      if (!inGap(ct) && !inGap(ct, captureGaps)) captures.push({ index: idx++, t: Math.round(ct), scene: sceneAt(ct), level: 4 + Math.floor(ct / 240000) });
      ct += step + rngCap() * jitter;
    }
  }

  const events: TimelineEvent[] = [];
  for (const s of sim.spikes) if (s.atSec * 1000 < endMs) events.push({ t: s.atSec * 1000, kind: 'scene', label: s.label });
  if (sim.loadReadySec !== undefined) {
    events.push({ t: 2000, kind: 'load-start', label: 'Launch trigger' });
    if ((2 + sim.loadReadySec) * 1000 < endMs) events.push({ t: (2 + sim.loadReadySec) * 1000, kind: 'load-ready', label: 'garden_ready marker' });
  }
  const script = c.playMode === 'bot' ? botScript(c.botScriptId) : undefined;
  if (script) {
    const loop = script.actions[script.actions.length - 1].atSec + 10;
    for (let base = 0; base * 1000 < endMs; base += loop) {
      for (const a of script.actions) {
        const at = (base + a.atSec) * 1000;
        if (at >= endMs) break;
        if (sim.botFailAtSec !== undefined && at >= sim.botFailAtSec * 1000) break;
        events.push({ t: at, kind: 'bot-action', label: a.action });
        if (a.checkpoint) events.push({ t: at + 2500, kind: 'bot-checkpoint', label: a.checkpoint });
      }
    }
    if (sim.botFailAtSec !== undefined && sim.botFailAtSec * 1000 <= endMs) {
      const next = script.actions.find((a) => a.checkpoint && a.atSec * 1000 >= (sim.botFailAtSec! - script.timeoutSec) * 1000);
      events.push({ t: sim.botFailAtSec * 1000, kind: 'bot-failure', label: `Checkpoint "${next?.checkpoint ?? 'next'}" not reached within ${script.timeoutSec} s` });
    }
  }
  if (session.endReason === 'disconnected') events.push({ t: endMs, kind: 'disconnect', label: 'Device disconnected' });
  events.sort((a, b) => a.t - b.t);

  return { frameT: Float64Array.from(frameT), frameDt: Float64Array.from(frameDt), series, charging: chargingStates, captures, events, gaps, endMs };
}

export const isLoadScenario = (s: Session) => scenario(s.config.scenarioId)?.profile === 'load-time';
