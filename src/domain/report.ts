import { analysisWindow, batteryStats, frameStats, loadTime, seriesStats, type BatteryStats, type FrameStats, type LoadTime, type SeriesStats } from './analysis';
import { build, device, project, scenario } from './catalog';
import { activeMetrics, availability, simulate } from './simulate';
import { evaluate, type Ruleset, type Verdict } from './verdict';
import type { Availability, DeviceProfile, MetricId, Session, Telemetry } from './types';

export interface Report {
  session: Session;
  device: DeviceProfile;
  title: string;
  tel: Telemetry;
  availability: Record<MetricId, Availability>;
  captured: MetricId[];
  frames: FrameStats | null;
  memory: SeriesStats | null;
  cpu: SeriesStats | null;
  temperature: SeriesStats | null;
  battery: BatteryStats;
  load: LoadTime | null;
  verdict: Verdict;
}

const cache = new Map<string, Report>();

export function reportKey(s: Session, rs: Ruleset) {
  return `${s.id}|${s.state}|${s.recordedMs}|${s.endReason ?? ''}|${rs.id}@${rs.version}|${s.annotations.map((a) => a.id).join(',')}`;
}

export function buildReport(s: Session, rs: Ruleset): Report {
  const key = reportKey(s, rs);
  const hit = cache.get(key);
  if (hit) return hit;
  const dev = device(s.config.deviceId)!;
  const tel = simulate(s, dev);
  const w = analysisWindow(s);
  const avail = Object.fromEntries(
    (['fps', 'frameTime', 'cpu', 'gpu', 'memory', 'temperature', 'battery', 'current', 'voltage', 'chargeCounter'] as MetricId[]).map((m) => [m, availability(s, dev, m)]),
  ) as Record<MetricId, Availability>;
  const captured = activeMetrics(s, dev);
  const frames = captured.includes('fps') || captured.includes('frameTime') ? frameStats(s, tel, rs.belowTargetFps, w) : null;
  const memory = seriesStats('memory', tel.series.memory, w);
  const r: Report = {
    session: s,
    device: dev,
    title: `${project(s.config.projectId)?.name} ${build(s.config.buildId)?.version} · ${scenario(s.config.scenarioId)?.name}`,
    tel,
    availability: avail,
    captured,
    frames,
    memory,
    cpu: seriesStats('cpu', tel.series.cpu, w),
    temperature: seriesStats('temperature', tel.series.temperature, w),
    battery: batteryStats(s, tel, avail.current === 'supported', avail.voltage === 'supported', avail.chargeCounter === 'supported'),
    load: loadTime(tel),
    verdict: evaluate(s, frames, memory, rs),
  };
  if (cache.size > 40) cache.clear();
  cache.set(key, r);
  return r;
}
