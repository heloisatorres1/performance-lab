import type { Availability, DeviceProfile, MetricId, SessionConfig } from '../domain/types';

// Integration boundaries. The public demo ships only simulated
// implementations. A live version talks to a local companion collector and a
// server that holds publishing credentials; the browser never does either.

/**
 * A local companion process (desktop app or service) that owns device access
 * through authorised platform tools. The web UI talks to it over a narrowly
 * scoped, authenticated localhost API and event stream. It binds to localhost
 * by default, restricts origins, validates arguments and runs subprocesses
 * without interpolated shell commands.
 */
export interface CompanionCollector {
  readonly name: string;
  readonly version: string;
  listDevices(): Promise<DeviceProfile[]>;
  capabilities(deviceId: string): Promise<Record<MetricId, Availability>>;
  start(config: SessionConfig): Promise<{ runId: string }>;
  /** Streams samples, frames, captures and events on the session timeline. Returns an unsubscribe function. */
  subscribe(runId: string, onEvent: (e: CollectorEvent) => void): () => void;
  addMarker(runId: string, tMs: number, text: string): Promise<void>;
  /** Flushes buffers and returns the manifest of what was actually recorded. */
  stop(runId: string): Promise<{ manifestPath: string }>;
  cancel(runId: string): Promise<void>;
}

export type CollectorEvent =
  | { type: 'sample'; metric: MetricId; t: number; v: number | null }
  | { type: 'frame'; t: number; dt: number }
  | { type: 'capture'; t: number; file: string }
  | { type: 'state'; state: 'recording' | 'stopping' | 'disconnected' | 'failed'; detail?: string };

export class PublishError extends Error {
  constructor(
    message: string,
    readonly kind: 'permission' | 'rate_limited' | 'timeout' | 'schema' | 'failed',
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

export interface PublishPageInput {
  dedupeKey: string;
  destinationId: string;
  title: string;
  properties: Record<string, string>;
  blocks: string[];
}

/** A report destination such as a Notion database. */
export interface ReportPublisher {
  readonly name: string;
  createPage(input: PublishPageInput): Promise<{ pageId: string; url: string }>;
  /** Used to reconcile an ambiguous timeout before creating again. */
  findPage(dedupeKey: string): Promise<{ pageId: string; url: string } | null>;
  uploadAsset(input: { pageId: string; dedupeKey: string; name: string; kind: 'chart' | 'raw' }): Promise<{ assetId: string }>;
}
