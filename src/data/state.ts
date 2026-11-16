import { useSyncExternalStore } from 'react';
import type { Session, SessionConfig } from '../domain/types';
import type { Ruleset } from '../domain/verdict';
import type { MockNotionState } from '../integrations/mockNotion';
import type { Publication } from '../integrations/publication';
import { config as fixtureConfig, DESTINATIONS, fixtureNotion, fixturePublications, fixtureSessions, RULESET, type Destination } from './fixtures';

export interface LiveRecording {
  sessionId: string;
  /** Wall-clock ms when the current speed segment started. */
  segmentStartedAt: number;
  /** Session time reached at the start of the segment. */
  segmentBaseMs: number;
  speed: number;
}

export interface ActivityItem {
  id: string;
  at: string;
  text: string;
  link?: string;
}

export interface AppState {
  version: number;
  sessions: Session[];
  ruleset: Ruleset;
  rulesetHistory: Ruleset[];
  publications: Publication[];
  notion: MockNotionState;
  destinations: Destination[];
  live: LiveRecording | null;
  activity: ActivityItem[];
  ui: {
    draft: SessionConfig;
    continuationOf?: Session['continuationOf'];
    compare: { baselineId: string; candidateId: string; acknowledged: boolean };
    botFailNext: boolean;
    selectedDestinationId: string;
  };
}

export const STORAGE_KEY = 'performance-lab.demo.v1';
export const SCHEMA_VERSION = 1;

export function seed(): AppState {
  return {
    version: SCHEMA_VERSION,
    sessions: fixtureSessions(),
    ruleset: RULESET,
    rulesetHistory: [
      { ...RULESET, version: 1, maxP95FrameMs: 30, updatedAt: '2026-10-01T10:00:00.000Z' },
      { ...RULESET, version: 2, maxP95FrameMs: 28, updatedAt: '2026-10-20T10:00:00.000Z' },
    ],
    publications: fixturePublications(),
    notion: fixtureNotion(),
    destinations: DESTINATIONS,
    live: null,
    activity: [],
    ui: {
      draft: fixtureConfig({}),
      compare: { baselineId: 'ses-083', candidateId: 'ses-084', acknowledged: false },
      botFailNext: false,
      selectedDestinationId: 'dest-demo',
    },
  };
}

type Listener = () => void;

export interface Store {
  get(): AppState;
  set(update: (s: AppState) => AppState): void;
  replace(next: AppState): void;
  subscribe(l: Listener): () => void;
}

export function createStore(initial: AppState, persist?: (s: AppState) => void): Store {
  let state = initial;
  const listeners = new Set<Listener>();
  const emit = () => listeners.forEach((l) => l());
  return {
    get: () => state,
    set(update) {
      state = update(state);
      persist?.(state);
      emit();
    },
    replace(next) {
      state = next;
      persist?.(state);
      emit();
    },
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

export function loadPersisted(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AppState;
    return parsed.version === SCHEMA_VERSION && Array.isArray(parsed.sessions) ? parsed : null;
  } catch {
    return null;
  }
}

export function persist(s: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Storage may be unavailable (private mode, quota). The demo keeps working in memory.
  }
}

let active: Store | null = null;
export function setActiveStore(s: Store) {
  active = s;
}
export function store(): Store {
  if (!active) throw new Error('Store not initialised');
  return active;
}

export function useAppState(): AppState {
  const s = store();
  return useSyncExternalStore(s.subscribe, s.get, s.get);
}
