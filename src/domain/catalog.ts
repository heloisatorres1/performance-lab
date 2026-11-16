import type { BotScript, Build, DeviceProfile, MetricDef, MetricId, Project, Scenario } from './types';

// Every device, game, build and script here is fictional demo data.

export const METRICS: Record<MetricId, MetricDef> = {
  fps: { id: 'fps', label: 'Frame rate', unit: 'FPS', scope: 'frame presentation', source: 'Presented-frame events (simulated)', aggregation: 'Frames presented per 1 s window' },
  frameTime: { id: 'frameTime', label: 'Frame time', unit: 'ms', scope: 'frame presentation', source: 'Interval between consecutive presented frames (simulated)', aggregation: 'Per frame' },
  cpu: { id: 'cpu', label: 'CPU (system)', unit: '%', scope: 'system', source: 'System CPU counters (simulated)', aggregation: '1 s average; 100% = all cores busy' },
  gpu: { id: 'gpu', label: 'GPU utilisation', unit: '%', scope: 'system', source: 'Vendor GPU counter', aggregation: '1 s average' },
  memory: { id: 'memory', label: 'Memory (PSS)', unit: 'MB', scope: 'game process', source: 'Proportional set size of the game process (simulated)', aggregation: '1 s sample' },
  temperature: { id: 'temperature', label: 'Battery temperature', unit: '°C', scope: 'battery sensor', source: 'Battery temperature sensor (simulated)', aggregation: '1 s sample' },
  battery: { id: 'battery', label: 'Battery level', unit: '%', scope: 'device battery', source: 'Battery level, 1% granularity (simulated)', aggregation: '1 s sample' },
  current: { id: 'current', label: 'Battery current', unit: 'mA', scope: 'device battery', source: 'Instantaneous battery current; negative while discharging (simulated)', aggregation: '1 s sample' },
  voltage: { id: 'voltage', label: 'Battery voltage', unit: 'V', scope: 'device battery', source: 'Battery voltage (simulated)', aggregation: '1 s sample' },
  chargeCounter: { id: 'chargeCounter', label: 'Charge counter', unit: 'µAh', scope: 'device battery', source: 'Remaining charge counter (simulated)', aggregation: '1 s sample' },
};

/** Metrics a user can choose to capture. Battery electrics follow the battery option. */
export const SELECTABLE_METRICS: MetricId[] = ['fps', 'frameTime', 'cpu', 'gpu', 'memory', 'temperature', 'battery'];

export const PROJECTS: Project[] = [{ id: 'og', name: 'Orbit Garden', packageId: 'com.example.orbitgarden' }];

export const BUILDS: Build[] = [
  { id: 'og-083', projectId: 'og', version: '0.8.3' },
  { id: 'og-084', projectId: 'og', version: '0.8.4' },
];

const allMetrics = (a: Partial<Record<MetricId, DeviceProfile['metrics'][MetricId]>>, fallback: DeviceProfile['metrics'][MetricId] = 'supported') =>
  Object.fromEntries((Object.keys(METRICS) as MetricId[]).map((m) => [m, a[m] ?? fallback])) as DeviceProfile['metrics'];

export const DEVICES: DeviceProfile[] = [
  {
    id: 'dev-phone',
    name: 'Android test device',
    platform: 'android',
    os: 'Android 15 (test profile)',
    cpu: 'ARM64, 8 cores',
    gpu: 'Generic mobile GPU',
    ramGb: 8,
    display: '2400 × 1080, 60 Hz',
    refreshHz: 60,
    connections: ['usb', 'wireless'],
    captures: { usb: ['off', 'screenshots', 'video'], wireless: ['off', 'screenshots'] },
    metrics: allMetrics({ gpu: 'unsupported', current: 'unsupported', chargeCounter: 'unsupported' }),
    botSupported: true,
    collector: 'simulated',
    wirelessNote: 'Wireless debugging needs a one-time pairing on this OS version. Video capture is not offered over wireless on this profile.',
  },
  {
    id: 'dev-tablet',
    name: 'Android reference tablet',
    platform: 'android',
    os: 'Android 14 (test profile)',
    cpu: 'ARM64, 8 cores',
    gpu: 'Generic tablet GPU',
    ramGb: 12,
    display: '2560 × 1600, 60 Hz',
    refreshHz: 60,
    connections: ['usb', 'wireless'],
    captures: { usb: ['off', 'screenshots', 'video'], wireless: ['off', 'screenshots'] },
    metrics: allMetrics({ gpu: 'denied' }),
    botSupported: true,
    collector: 'simulated',
    wirelessNote: 'Wireless debugging needs pairing. The tablet may still charge from a dock while wireless.',
  },
  {
    id: 'dev-ios',
    name: 'iOS test phone',
    platform: 'ios',
    os: 'iOS (test profile)',
    cpu: 'ARM64, 6 cores',
    gpu: 'Integrated GPU',
    ramGb: 6,
    display: '2532 × 1170, 60 Hz',
    refreshHz: 60,
    connections: ['usb'],
    captures: { usb: ['off'], wireless: [] },
    metrics: allMetrics({}, 'not-implemented'),
    botSupported: false,
    collector: 'not-implemented',
    wirelessNote: 'No iOS collector is implemented yet.',
  },
];

export const SCENARIOS: Scenario[] = [
  { id: 'sc-loop', projectId: 'og', name: 'Garden loop', description: 'Plant, water, harvest and enter the greenhouse. Includes one scene transition.', profile: 'exploratory' },
  { id: 'sc-bench', projectId: 'og', name: 'Harvest benchmark', description: 'Scripted, repeatable harvest route with fixed seed.', profile: 'benchmark' },
  { id: 'sc-battery', projectId: 'og', name: 'Battery observation', description: 'Idle garden with ambient animation, screen on, unplugged.', profile: 'battery' },
  { id: 'sc-load', projectId: 'og', name: 'Cold launch to garden', description: 'Launch trigger to the instrumented garden_ready marker.', profile: 'load-time' },
];

export const BOT_SCRIPTS: BotScript[] = [
  {
    id: 'bot-harvest',
    name: 'Harvest route',
    version: '1.2.0',
    projectId: 'og',
    buildRange: ['0.8.0', '0.8.9'],
    seed: 4242,
    actions: [
      { atSec: 5, action: 'Tap plot 1–9 to plant', checkpoint: 'Seeds planted' },
      { atSec: 70, action: 'Water all plots' },
      { atSec: 160, action: 'Harvest ripe plots', checkpoint: 'Harvest complete' },
      { atSec: 250, action: 'Open greenhouse', checkpoint: 'Greenhouse open' },
      { atSec: 420, action: 'Return to garden', checkpoint: 'Loop complete' },
    ],
    timeoutSec: 30,
    restartPolicy: 'none',
    stopConditions: ['Checkpoint not reached within timeout', 'Stop pressed', 'Device disconnected'],
  },
];

export const COLLECTOR_VERSIONS = { collector: 'sim-collector 0.3.0', frames: 'sim-frames 0.3.0', capture: 'sim-capture 0.2.1' };

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

export const device = (id: string) => DEVICES.find((d) => d.id === id);
export const build = (id: string) => BUILDS.find((b) => b.id === id);
export const scenario = (id: string) => SCENARIOS.find((s) => s.id === id);
export const project = (id: string) => PROJECTS.find((p) => p.id === id);
export const botScript = (id?: string) => BOT_SCRIPTS.find((s) => s.id === id);
