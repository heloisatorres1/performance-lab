import { COLLECTOR_VERSIONS } from '../domain/catalog';
import type { MetricId, Session, SessionConfig, SimProfile } from '../domain/types';
import type { Ruleset } from '../domain/verdict';
import { newPublication, type Publication } from '../integrations/publication';
import { emptyNotion, type MockNotionState } from '../integrations/mockNotion';

export const DEFAULT_METRICS: MetricId[] = ['fps', 'frameTime', 'cpu', 'memory', 'temperature', 'battery'];

export function sim(o: Partial<SimProfile>): SimProfile {
  return { baseFrameMs: 1000 / 60, hitchRate: 0.025, spikes: [], memStartMb: 1180, memGrowMbPerMin: 12, tempStartC: 31.5, tempRiseC: 9, batteryStart: 80, batteryEnd: 72, ...o };
}

export function config(o: Partial<SessionConfig>): SessionConfig {
  return {
    projectId: 'og',
    buildId: 'og-084',
    deviceId: 'dev-phone',
    scenarioId: 'sc-loop',
    connection: 'wireless',
    playMode: 'manual',
    capture: 'screenshots',
    targetFps: 60,
    durationSec: 1200,
    warmupSec: 60,
    sampleHz: 1,
    captureIntervalSec: 2,
    metrics: DEFAULT_METRICS,
    notes: '',
    tags: [],
    fixtureBattery: { startLevel: 80, charging: false },
    ...o,
  };
}

export interface Destination {
  id: string;
  name: string;
  kind: string;
  mapping: { field: string; property: string }[];
}

export const DESTINATIONS: Destination[] = [
  {
    id: 'dest-demo',
    name: 'Demo performance reports',
    kind: 'Notion database (simulated)',
    mapping: [
      { field: 'Title', property: 'Name' },
      { field: 'Build', property: 'Build' },
      { field: 'Device', property: 'Device' },
      { field: 'Scenario', property: 'Scenario' },
      { field: 'Verdict', property: 'Status' },
      { field: 'Average FPS', property: 'Avg FPS' },
      { field: 'p95 frame time', property: 'p95 frame ms' },
    ],
  },
];

export const RULESET: Ruleset = {
  id: 'rs-og',
  version: 3,
  projectId: 'og',
  name: 'Orbit Garden mobile',
  minAvgFps: 55,
  maxP95FrameMs: 25,
  belowTargetFps: 54,
  maxBelowTargetPct: 5,
  maxPeakMemoryMb: 1600,
  minCoverage: 0.9,
  maxP95IncreaseMs: 3,
  maxAvgFpsDecrease: 1.5,
  maxPeakMemoryIncreaseMb: 100,
  updatedAt: '2026-11-02T10:00:00.000Z',
};

const spikes084 = [
  { atSec: 605, durSec: 1.6, extraMs: 45, label: 'Shop opens' },
  { atSec: 753, durSec: 1.8, extraMs: 60, label: 'Scene transition' },
  { atSec: 940, durSec: 1.4, extraMs: 40, label: 'Harvest burst' },
];

function session(id: string, name: string, cfg: SessionConfig, profile: SimProfile, seed: number, createdAt: string, extra: Partial<Session> = {}): Session {
  return {
    id,
    name,
    config: cfg,
    sim: profile,
    seed,
    state: 'complete',
    endReason: 'completed',
    createdAt,
    startedAtWall: createdAt,
    recordedMs: cfg.durationSec * 1000,
    annotations: [],
    collectorVersions: { ...COLLECTOR_VERSIONS },
    fixture: true,
    ...extra,
  };
}

export function fixtureSessions(): Session[] {
  return [
    session('ses-084', 'Garden loop · 0.8.4', config({}), sim({ hitchRate: 0.05, spikes: spikes084, memStartMb: 1220, memGrowMbPerMin: 14, tempStartC: 32 }), 84001, '2026-11-15T14:05:00.000Z', {
      annotations: [{ id: 'an-1', t: 753_400, text: 'Scene transition to greenhouse', createdAt: '2026-11-15T14:17:33.000Z' }],
    }),
    session('ses-083', 'Garden loop · 0.8.3', config({ buildId: 'og-083' }), sim({ hitchRate: 0.022, spikes: spikes084.slice(0, 2).map((s) => ({ ...s, extraMs: s.extraMs / 2.5 })), memStartMb: 1150, memGrowMbPerMin: 10, tempStartC: 31.8, batteryEnd: 73 }), 83001, '2026-11-12T09:40:00.000Z'),
    session(
      'ses-084-bot',
      'Harvest benchmark · USB · charging',
      config({ connection: 'usb', playMode: 'bot', botScriptId: 'bot-harvest', scenarioId: 'sc-bench', capture: 'video', durationSec: 600, warmupSec: 30, fixtureBattery: { startLevel: 64, charging: true } }),
      sim({ hitchRate: 0.03, spikes: [{ atSec: 252, durSec: 1.5, extraMs: 35, label: 'Scene transition' }], batteryStart: 64, batteryEnd: 64, chargingSec: [[0, 600]] }),
      84002,
      '2026-11-15T16:20:00.000Z',
    ),
    session(
      'ses-084-tablet',
      'Battery observation · tablet',
      config({ deviceId: 'dev-tablet', scenarioId: 'sc-battery', capture: 'off', durationSec: 900, warmupSec: 60, metrics: [...DEFAULT_METRICS, 'gpu'], fixtureBattery: { startLevel: 64, charging: false } }),
      sim({ hitchRate: 0.015, batteryStart: 64, batteryEnd: 60, tempStartC: 30.2, tempRiseC: 4, memStartMb: 980, memGrowMbPerMin: 4 }),
      84003,
      '2026-11-14T11:00:00.000Z',
    ),
    session('ses-084-int', 'Garden loop · disconnected', config({}), sim({ hitchRate: 0.05, spikes: spikes084.slice(0, 1) }), 84004, '2026-11-16T08:30:00.000Z', {
      state: 'interrupted',
      endReason: 'disconnected',
      recordedMs: 432_000,
    }),
    session(
      'ses-084-gaps',
      'Garden loop · USB · sensor denied',
      config({ connection: 'usb' }),
      sim({ hitchRate: 0.03, spikes: spikes084.slice(1, 2), deniedMetrics: ['temperature'], gapsSec: [[300, 330]], captureGapsSec: [[480, 570]] }),
      84005,
      '2026-11-16T10:10:00.000Z',
    ),
    session(
      'ses-084-botfail',
      'Harvest benchmark · bot failed',
      config({ connection: 'usb', playMode: 'bot', botScriptId: 'bot-harvest', scenarioId: 'sc-bench', durationSec: 600, warmupSec: 30, fixtureBattery: { startLevel: 90, charging: true } }),
      sim({ hitchRate: 0.03, spikes: [{ atSec: 252, durSec: 1.5, extraMs: 35, label: 'Scene transition' }], batteryStart: 90, batteryEnd: 90, chargingSec: [[0, 600]], botFailAtSec: 283 }),
      84006,
      '2026-11-16T11:45:00.000Z',
      { state: 'failed', endReason: 'bot-failed', recordedMs: 283_000 },
    ),
    session(
      'ses-084-load',
      'Cold launch to garden',
      config({ connection: 'usb', scenarioId: 'sc-load', durationSec: 60, warmupSec: 10, captureIntervalSec: 1, metrics: ['fps', 'frameTime', 'cpu', 'memory'], fixtureBattery: undefined }),
      sim({ hitchRate: 0.04, loadReadySec: 6.8, spikes: [{ atSec: 2, durSec: 6, extraMs: 30, label: 'Loading' }], memStartMb: 640, memGrowMbPerMin: 300 }),
      84007,
      '2026-11-16T12:30:00.000Z',
    ),
  ];
}

export function fixturePublications(): Publication[] {
  const failed = newPublication({
    id: 'pub-1',
    sourceId: 'ses-083',
    revision: 1,
    destinationId: 'dest-demo',
    destinationName: 'Demo performance reports',
    analysisKey: 'ses-083|rs-og@3',
    at: '2026-11-12T10:15:00.000Z',
    snapshot: {
      kind: 'report',
      title: 'Orbit Garden 0.8.3 · Garden loop · Performance report',
      properties: { Name: 'Orbit Garden 0.8.3 · Garden loop', Build: '0.8.3', Device: 'Android test device', Scenario: 'Garden loop', Status: 'Within thresholds' },
      summary: ['Simulated demo data.'],
      caveats: ['Screen capture enabled; compare matching configurations.'],
      charts: ['Frame rate', 'Frame time'],
      includeRaw: true,
      reportLink: 'performance-lab-garden-loop-0-8-3.zip (local bundle)',
    },
  });
  return [
    {
      ...failed,
      status: 'failed',
      steps: failed.steps.map((s, i) => (i === 0 ? { ...s, status: 'failed' } : s)),
      attempts: [{ at: '2026-11-12T10:15:02.000Z', step: 'Create page', outcome: 'permission', detail: 'The integration has no access to this database (simulated 403). Share the database with the integration and retry.' }],
    },
  ];
}

export function fixtureNotion(): MockNotionState {
  return emptyNotion();
}
