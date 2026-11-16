import { COLLECTOR_VERSIONS, build, device, scenario } from '../domain/catalog';
import { transition } from '../domain/lifecycle';
import { combinationProblems, isReady, readiness } from '../domain/readiness';
import type { Annotation, EndReason, Session, SessionConfig, SimProfile } from '../domain/types';
import type { Ruleset } from '../domain/verdict';
import { createMockNotion, type NotionFaults } from '../integrations/mockNotion';
import { newPublication, prepareRetry, runPublication, type PublicationSnapshot } from '../integrations/publication';
import { sim } from './fixtures';
import { seed, store, type AppState } from './state';

export const timing = { stepDelayMs: 300 };

const nowIso = () => new Date().toISOString();
const wait = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
let counter = 0;
export const uid = (p: string) => `${p}-${Date.now().toString(36)}${(counter++).toString(36)}`;

function update(fn: (s: AppState) => AppState) {
  store().set(fn);
}

function log(text: string, link?: string) {
  update((s) => ({ ...s, activity: [{ id: uid('act'), at: nowIso(), text, link }, ...s.activity].slice(0, 50) }));
}

function patchSession(id: string, fn: (x: Session) => Session) {
  update((s) => ({ ...s, sessions: s.sessions.map((x) => (x.id === id ? fn(x) : x)) }));
}

const getSession = (id: string) => store().get().sessions.find((x) => x.id === id);

// ---- Setup -----------------------------------------------------------------

/** Keeps the draft inside what the chosen device profile supports. */
export function normaliseDraft(c: SessionConfig): SessionConfig {
  const d = device(c.deviceId);
  if (!d) return c;
  const next = { ...c };
  if (!d.connections.includes(next.connection)) next.connection = d.connections[0];
  const caps = d.captures[next.connection] ?? [];
  if (!caps.includes(next.capture)) next.capture = caps.includes('screenshots') ? 'screenshots' : (caps[0] ?? 'off');
  if (!d.botSupported && next.playMode === 'bot') next.playMode = 'manual';
  if (next.playMode === 'bot' && !next.botScriptId) next.botScriptId = 'bot-harvest';
  if (next.playMode === 'manual') delete next.botScriptId;
  return next;
}

export function setDraft(patch: Partial<SessionConfig>) {
  update((s) => ({ ...s, ui: { ...s.ui, draft: normaliseDraft({ ...s.ui.draft, ...patch }) } }));
}

export function setBotFailNext(v: boolean) {
  update((s) => ({ ...s, ui: { ...s.ui, botFailNext: v } }));
}

/** Simulation shape for a new session, from the build and scenario. */
export function simFor(c: SessionConfig, botFails: boolean): SimProfile {
  const is084 = build(c.buildId)?.version === '0.8.4';
  const sc = scenario(c.scenarioId);
  const spikes = is084
    ? [
        { atSec: 95, durSec: 1.6, extraMs: 45, label: 'Shop opens' },
        { atSec: 210, durSec: 1.8, extraMs: 60, label: 'Scene transition' },
        { atSec: 455, durSec: 1.4, extraMs: 40, label: 'Harvest burst' },
      ]
    : [{ atSec: 210, durSec: 1.4, extraMs: 24, label: 'Scene transition' }];
  const fb = c.fixtureBattery ?? { startLevel: 80, charging: false };
  const minutes = c.durationSec / 60;
  return sim({
    hitchRate: is084 ? 0.05 : 0.022,
    spikes: sc?.profile === 'battery' ? [] : spikes.filter((x) => x.atSec < c.durationSec),
    batteryStart: fb.startLevel,
    batteryEnd: fb.charging ? fb.startLevel : Math.max(1, Math.round(fb.startLevel - minutes * 0.4)),
    chargingSec: fb.charging ? [[0, c.durationSec]] : undefined,
    loadReadySec: sc?.profile === 'load-time' ? (is084 ? 6.8 : 6.1) : undefined,
    botFailAtSec: botFails && c.playMode === 'bot' ? 75 : undefined,
  });
}

export function setupProblems(c: SessionConfig): string[] {
  const problems = combinationProblems(c);
  if (!isReady(readiness(c))) problems.push('Resolve the failed readiness checks first.');
  return problems;
}

/** draft → checking → ready → starting → recording. Returns the new session id. */
export async function startSession(): Promise<string | null> {
  const s = store().get();
  if (s.live) return null;
  const c = normaliseDraft(s.ui.draft);
  if (setupProblems(c).length) return null;
  const id = uid('ses');
  const d = device(c.deviceId)!;
  const name = `${scenario(c.scenarioId)?.name ?? 'Session'} · ${build(c.buildId)?.version} · ${d.name}`;
  const session: Session = {
    id,
    name,
    config: c,
    seed: (Date.now() % 1_000_000) + counter++,
    sim: simFor(c, s.ui.botFailNext),
    state: 'draft',
    createdAt: nowIso(),
    recordedMs: 0,
    annotations: [],
    collectorVersions: { ...COLLECTOR_VERSIONS },
    continuationOf: s.ui.continuationOf,
    fixture: false,
  };
  update((st) => ({ ...st, sessions: [session, ...st.sessions], ui: { ...st.ui, botFailNext: false, continuationOf: undefined } }));
  for (const next of ['checking', 'ready', 'starting'] as const) {
    patchSession(id, (x) => transition(x, next));
    await wait(timing.stepDelayMs);
    if (getSession(id)?.state === 'cancelled') return id;
  }
  patchSession(id, (x) => ({ ...transition(x, 'recording'), startedAtWall: nowIso() }));
  update((st) => ({ ...st, live: { sessionId: id, segmentStartedAt: Date.now(), segmentBaseMs: 0, speed: 10 } }));
  log(`Recording started: ${name}`, '/live');
  return id;
}

export function liveElapsedMs(st: AppState, now = Date.now()): number {
  const live = st.live;
  if (!live) return 0;
  const sess = st.sessions.find((x) => x.id === live.sessionId);
  const max = sess ? sess.config.durationSec * 1000 : Infinity;
  return Math.min(max, live.segmentBaseMs + (now - live.segmentStartedAt) * live.speed);
}

export function setLiveSpeed(speed: number) {
  update((s) => {
    if (!s.live) return s;
    const base = liveElapsedMs(s);
    return { ...s, live: { ...s.live, segmentBaseMs: base, segmentStartedAt: Date.now(), speed } };
  });
}

/** Persists progress so a closed tab still leaves recoverable partial data. */
export function checkpointLive() {
  const s = store().get();
  if (!s.live) return;
  const elapsed = liveElapsedMs(s);
  patchSession(s.live.sessionId, (x) => (x.state === 'recording' ? { ...x, recordedMs: elapsed } : x));
}

async function finish(id: string, elapsed: number, reason: EndReason) {
  update((s) => ({ ...s, live: null }));
  patchSession(id, (x) => ({ ...transition(x, 'stopping'), recordedMs: elapsed }));
  await wait(timing.stepDelayMs);
  patchSession(id, (x) => transition(x, 'processing'));
  await wait(timing.stepDelayMs);
  patchSession(id, (x) => ({ ...transition(x, 'complete'), endReason: reason }));
  log(`Report ready: ${getSession(id)?.name}`, `/results/${id}`);
}

/** Stop & save: flushes what was recorded and builds the report. */
export async function stopSession(id: string) {
  const s = store().get();
  const sess = getSession(id);
  if (!sess || sess.state !== 'recording') return;
  const elapsed = Math.floor(liveElapsedMs(s));
  await finish(id, elapsed, elapsed >= sess.config.durationSec * 1000 ? 'completed' : 'stopped-early');
}

/** Interrupted / failed / cancelled keep partial data and never resume. */
export function endRecording(id: string, to: 'interrupted' | 'failed' | 'cancelled', reason: EndReason) {
  const s = store().get();
  const sess = getSession(id);
  if (!sess || sess.state !== 'recording') return;
  const elapsed = Math.floor(reason === 'bot-failed' && sess.sim.botFailAtSec ? sess.sim.botFailAtSec * 1000 : liveElapsedMs(s));
  update((st) => ({ ...st, live: null }));
  patchSession(id, (x) => ({ ...transition(x, to), endReason: reason, recordedMs: elapsed }));
  log(`${to === 'interrupted' ? 'Recording interrupted' : to === 'failed' ? 'Recording failed' : 'Recording cancelled'}: ${sess.name}`, `/results/${id}`);
}

export function cancelBeforeRecording(id: string) {
  patchSession(id, (x) => (['draft', 'checking', 'ready', 'starting'].includes(x.state) ? { ...x, state: 'cancelled', endReason: 'cancelled' } : x));
}

/** On load, a session left mid-recording becomes interrupted; nothing resumes silently. */
export function recoverAfterReload() {
  const s = store().get();
  const stuck = s.sessions.filter((x) => ['checking', 'ready', 'starting', 'recording', 'stopping', 'processing'].includes(x.state));
  if (!stuck.length && !s.live) return;
  update((st) => ({
    ...st,
    live: null,
    sessions: st.sessions.map((x) => {
      if (x.state === 'recording') return { ...x, state: 'interrupted', endReason: 'browser-closed' };
      if (x.state === 'stopping' || x.state === 'processing') return { ...x, state: 'complete', endReason: x.recordedMs >= x.config.durationSec * 1000 ? 'completed' : 'stopped-early' };
      if (['checking', 'ready', 'starting'].includes(x.state)) return { ...x, state: 'cancelled', endReason: 'cancelled' };
      return x;
    }),
  }));
}

export function addAnnotation(sessionId: string, t: number, text: string): Annotation | null {
  const clean = text.trim().slice(0, 200);
  if (!clean) return null;
  const a: Annotation = { id: uid('an'), t: Math.max(0, Math.round(t)), text: clean, createdAt: nowIso() };
  patchSession(sessionId, (x) => ({ ...x, annotations: [...x.annotations, a].sort((p, q) => p.t - q.t) }));
  return a;
}

export function removeAnnotation(sessionId: string, annotationId: string) {
  patchSession(sessionId, (x) => ({ ...x, annotations: x.annotations.filter((a) => a.id !== annotationId) }));
}

/** A continuation is a new session linked to the old one; the gap is kept. */
export function prepareContinuation(id: string) {
  const sess = getSession(id);
  if (!sess) return;
  const at = new Date(sess.recordedMs).toISOString().slice(14, 19);
  update((s) => ({
    ...s,
    ui: { ...s.ui, draft: { ...sess.config, notes: `Continuation of "${sess.name}"` }, continuationOf: { sessionId: id, gapNote: `Continues after the interruption at ${at}. The gap between recordings is not joined.` } },
  }));
}

export function deleteSession(id: string) {
  update((s) => ({ ...s, sessions: s.sessions.filter((x) => x.id !== id || x.state === 'recording') }));
}

// ---- Compare ------------------------------------------------------------------

export function setCompare(patch: Partial<AppState['ui']['compare']>) {
  update((s) => {
    const next = { ...s.ui.compare, ...patch };
    if (patch.baselineId || patch.candidateId) next.acknowledged = patch.acknowledged ?? false;
    return { ...s, ui: { ...s.ui, compare: next } };
  });
}

// ---- Rules ----------------------------------------------------------------------

/** Rules are versioned. Saving creates a new version; history is kept. */
export function saveRuleset(patch: Partial<Ruleset>) {
  update((s) => ({ ...s, rulesetHistory: [...s.rulesetHistory, s.ruleset], ruleset: { ...s.ruleset, ...patch, version: s.ruleset.version + 1, updatedAt: nowIso() } }));
  log(`Ruleset updated to version ${store().get().ruleset.version}`, '/settings');
}

// ---- Publishing -----------------------------------------------------------------

export function publisher() {
  return createMockNotion({ get: () => store().get().notion, set: (notion) => update((s) => ({ ...s, notion })) });
}

export function setNotionFaults(patch: Partial<NotionFaults>) {
  update((s) => ({ ...s, notion: { ...s.notion, faults: { ...s.notion.faults, ...patch } } }));
}

export function setDestination(id: string) {
  update((s) => ({ ...s, ui: { ...s.ui, selectedDestinationId: id } }));
}

const running = new Set<string>();

async function run(pubId: string) {
  if (running.has(pubId)) return;
  running.add(pubId);
  try {
    await wait(timing.stepDelayMs);
    const pub = store().get().publications.find((p) => p.id === pubId);
    if (!pub) return;
    const next = await runPublication(pub, publisher(), nowIso);
    update((s) => ({ ...s, publications: s.publications.map((p) => (p.id === pubId ? next : p)) }));
    log(`Publication ${next.status}: ${next.snapshot.title}`, '/publishing');
  } finally {
    running.delete(pubId);
  }
}

/** Explicit, user-triggered publish of a frozen snapshot. Saved locally first. */
export async function publishSnapshot(sourceId: string, snapshot: PublicationSnapshot, analysisKey: string): Promise<string> {
  const s = store().get();
  const dest = s.destinations.find((d) => d.id === s.ui.selectedDestinationId) ?? s.destinations[0];
  const revision = s.publications.filter((p) => p.sourceId === sourceId && p.destinationId === dest.id).reduce((m, p) => Math.max(m, p.revision), 0) + 1;
  const pub = newPublication({ id: uid('pub'), sourceId, revision, destinationId: dest.id, destinationName: dest.name, snapshot, analysisKey, at: nowIso() });
  update((st) => ({ ...st, publications: [pub, ...st.publications] }));
  await run(pub.id);
  return pub.id;
}

export async function retryPublication(pubId: string) {
  update((s) => ({ ...s, publications: s.publications.map((p) => (p.id === pubId ? prepareRetry(p) : p)) }));
  await run(pubId);
}

export function resetDemo() {
  store().replace(seed());
}
