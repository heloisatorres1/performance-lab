// Core model. All times on a session's timeline are milliseconds of
// monotonic session time (0 = actual recording start). Wall-clock values are
// ISO strings kept as metadata only.

export type ID = string;
export type ISODate = string;
export type Ms = number;

export type Connection = 'usb' | 'wireless';
export type PlayMode = 'manual' | 'bot';
export type CaptureMode = 'off' | 'screenshots' | 'video';
export type Platform = 'android' | 'ios';

export type MetricId = 'fps' | 'frameTime' | 'cpu' | 'gpu' | 'memory' | 'temperature' | 'battery' | 'current' | 'voltage' | 'chargeCounter';

/** Missing, unsupported, denied and not implemented are never zero. */
export type Availability = 'supported' | 'unsupported' | 'denied' | 'not-implemented';

export interface MetricDef {
  id: MetricId;
  label: string;
  unit: string;
  scope: 'game process' | 'system' | 'battery sensor' | 'device battery' | 'frame presentation';
  source: string;
  aggregation: string;
}

export interface DeviceProfile {
  id: ID;
  name: string;
  platform: Platform;
  os: string;
  cpu: string;
  gpu: string;
  ramGb: number;
  display: string;
  refreshHz: number;
  connections: Connection[];
  /** Capture modes this profile supports per connection. */
  captures: Record<Connection, CaptureMode[]>;
  metrics: Record<MetricId, Availability>;
  botSupported: boolean;
  collector: 'simulated' | 'not-implemented';
  wirelessNote: string;
}

export interface Project {
  id: ID;
  name: string;
  packageId: string;
}

export interface Build {
  id: ID;
  projectId: ID;
  version: string;
}

export type SessionProfile = 'exploratory' | 'benchmark' | 'battery' | 'load-time';

export interface Scenario {
  id: ID;
  projectId: ID;
  name: string;
  description: string;
  profile: SessionProfile;
}

export interface BotAction {
  atSec: number;
  action: string;
  checkpoint?: string;
}

export interface BotScript {
  id: ID;
  name: string;
  version: string;
  projectId: ID;
  /** Inclusive semantic version range, e.g. 0.8.0 – 0.8.9. */
  buildRange: [string, string];
  seed: number;
  actions: BotAction[];
  timeoutSec: number;
  restartPolicy: 'none';
  stopConditions: string[];
}

export interface SessionConfig {
  projectId: ID;
  buildId: ID;
  deviceId: ID;
  scenarioId: ID;
  connection: Connection;
  playMode: PlayMode;
  capture: CaptureMode;
  botScriptId?: ID;
  targetFps: number;
  durationSec: number;
  warmupSec: number;
  sampleHz: number;
  captureIntervalSec: number;
  metrics: MetricId[];
  notes: string;
  tags: string[];
  /** Fixture-only battery start. Live mode reads this from the collector. */
  fixtureBattery?: { startLevel: number; charging: boolean };
}

export type SessionState = 'draft' | 'checking' | 'ready' | 'starting' | 'recording' | 'stopping' | 'processing' | 'complete' | 'failed' | 'cancelled' | 'interrupted';

export type EndReason = 'completed' | 'stopped-early' | 'disconnected' | 'cancelled' | 'collector-failed' | 'bot-failed' | 'browser-closed';

export interface Annotation {
  id: ID;
  t: Ms;
  text: string;
  createdAt: ISODate;
}

/** Shapes the deterministic simulation. Fixtures set these explicitly. */
export interface SimProfile {
  baseFrameMs: number;
  /** Probability per frame of a missed presentation deadline. */
  hitchRate: number;
  spikes: { atSec: number; durSec: number; extraMs: number; label: string }[];
  memStartMb: number;
  memGrowMbPerMin: number;
  tempStartC: number;
  tempRiseC: number;
  batteryStart: number;
  batteryEnd: number;
  /** Seconds (from start) during which the device reported external power. */
  chargingSec?: [number, number][];
  /** Telemetry gaps: no samples or frames observed. */
  gapsSec?: [number, number][];
  /** Capture-only gaps: telemetry continues, no screenshots. */
  captureGapsSec?: [number, number][];
  /** Metrics that became denied for the whole session. */
  deniedMetrics?: MetricId[];
  /** For load-time scenarios: launch trigger → ready marker. */
  loadReadySec?: number;
  botFailAtSec?: number;
}

export interface Session {
  id: ID;
  name: string;
  config: SessionConfig;
  seed: number;
  sim: SimProfile;
  state: SessionState;
  endReason?: EndReason;
  createdAt: ISODate;
  startedAtWall?: ISODate;
  /** Actual recorded length on the session timeline. */
  recordedMs: Ms;
  annotations: Annotation[];
  collectorVersions: Record<string, string>;
  continuationOf?: { sessionId: ID; gapNote: string };
  fixture: boolean;
}

export interface Sample {
  t: Ms;
  v: number | null;
}

export interface Capture {
  index: number;
  t: Ms;
  scene: 'garden' | 'greenhouse' | 'loading';
  level: number;
}

export interface TimelineEvent {
  t: Ms;
  kind: 'bot-action' | 'bot-checkpoint' | 'bot-failure' | 'scene' | 'load-start' | 'load-ready' | 'disconnect';
  label: string;
}

export interface Gap {
  fromMs: Ms;
  toMs: Ms;
  stream: 'telemetry' | 'capture';
}

export interface Telemetry {
  /** Presentation timestamps of eligible frames, and the interval before each. */
  frameT: Float64Array;
  frameDt: Float64Array;
  series: Partial<Record<MetricId, Sample[]>>;
  charging: { t: Ms; charging: boolean }[];
  captures: Capture[];
  events: TimelineEvent[];
  gaps: Gap[];
  endMs: Ms;
}
