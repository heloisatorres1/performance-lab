import { createMockNotion, emptyNotion, type MockNotionState } from '../src/integrations/mockNotion';
import { newPublication, prepareRetry, runPublication, type PublicationSnapshot } from '../src/integrations/publication';
import { createStore, seed, setActiveStore, store } from '../src/data/state';
import { addAnnotation, endRecording, publishSnapshot, recoverAfterReload, removeAnnotation, retryPublication, setBotFailNext, setDraft, setNotionFaults, startSession, stopSession, tickLive, timing } from '../src/data/actions';
import { buildReport } from '../src/domain/report';

const snapshot: PublicationSnapshot = { kind: 'report', title: 'T', properties: {}, summary: ['s'], caveats: [], charts: ['FPS', 'Frame time'], includeRaw: true, reportLink: 'local' };
const now = () => '2026-11-16T12:00:00.000Z';

function remote(faults: Partial<MockNotionState['faults']> = {}) {
  const holder = { state: { ...emptyNotion(), faults: { ...emptyNotion().faults, ...faults } } };
  const pub = createMockNotion({ get: () => holder.state, set: (s) => (holder.state = s) });
  return { holder, pub };
}

const fetchSpy = vi.fn();
beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('publishing', () => {
  const base = () => newPublication({ id: 'p', sourceId: 'ses-1', revision: 1, destinationId: 'd', destinationName: 'D', snapshot, analysisKey: 'k', at: now() });

  it('publishes a page then its assets', async () => {
    const { holder, pub } = remote();
    const out = await runPublication(base(), pub, now);
    expect(out.status).toBe('published');
    expect(holder.state.pages).toHaveLength(1);
    expect(holder.state.assets).toHaveLength(3);
  });

  it('an ambiguous timeout reconciles on retry instead of creating a second page', async () => {
    const { holder, pub } = remote({ timeoutNext: true });
    const first = await runPublication(base(), pub, now);
    expect(first.status).toBe('uncertain');
    expect(holder.state.pages).toHaveLength(1);
    const second = await runPublication(prepareRetry(first), pub, now);
    expect(second.status).toBe('published');
    expect(second.attempts.map((a) => a.outcome)).toContain('reconciled');
    expect(holder.state.pages).toHaveLength(1);
  });

  it('an asset failure leaves a partial publication; retry uploads only what is missing', async () => {
    const { holder, pub } = remote({ assetFailNext: true });
    const first = await runPublication(base(), pub, now);
    expect(first.status).toBe('partial');
    const second = await runPublication(prepareRetry(first), pub, now);
    expect(second.status).toBe('published');
    expect(holder.state.pages).toHaveLength(1);
    expect(holder.state.assets).toHaveLength(3);
  });

  it('permission and rate-limit errors fail clearly and keep the local publication', async () => {
    const { pub } = remote({ permissionNext: true });
    const out = await runPublication(base(), pub, now);
    expect(out.status).toBe('failed');
    expect(out.attempts[0].outcome).toBe('permission');
    expect(out.snapshot.title).toBe('T');
  });
});

describe('recording lifecycle', () => {
  beforeEach(() => {
    timing.stepDelayMs = 0;
    setActiveStore(createStore(seed()));
  });

  it('setup → record → stop & save produces a complete report', async () => {
    const id = (await startSession())!;
    expect(store().get().sessions.find((s) => s.id === id)!.state).toBe('recording');
    addAnnotation(id, 4000, 'Opened shop');
    await stopSession(id);
    const s = store().get().sessions.find((x) => x.id === id)!;
    expect(s.state).toBe('complete');
    expect(s.endReason).toBe('stopped-early');
    expect(s.annotations[0].text).toBe('Opened shop');
    expect(store().get().live).toBeNull();
  });

  it('the recording clock stops at the planned duration without the Live page open', async () => {
    setDraft({ durationSec: 60, warmupSec: 10 });
    const id = (await startSession())!;
    const live = store().get().live!;
    expect(tickLive(live.segmentStartedAt + 1000)).toBeNull();
    // 10× speed: 6 s of wall time covers the 60 s session.
    expect(tickLive(live.segmentStartedAt + 7000)).toBe(id);
    await new Promise((r) => setTimeout(r, 0));
    const s = store().get().sessions.find((x) => x.id === id)!;
    expect(s.state).toBe('complete');
    expect(s.recordedMs).toBe(60_000);
    expect(s.endReason).toBe('completed');
  });

  it('a bot that misses a checkpoint fails the run separately from the collector', async () => {
    setDraft({ playMode: 'bot', connection: 'usb', botScriptId: 'bot-harvest' });
    setBotFailNext(true);
    const id = (await startSession())!;
    const live = store().get().live!;
    expect(tickLive(live.segmentStartedAt + 8000)).toBe(id);
    const s = store().get().sessions.find((x) => x.id === id)!;
    expect(s.state).toBe('failed');
    expect(s.endReason).toBe('bot-failed');
    expect(s.recordedMs).toBe(75_000);
  });

  it('report cache follows marker changes, not just their count', () => {
    const a = addAnnotation('ses-084', 1000, 'first')!;
    const before = buildReport(store().get().sessions.find((x) => x.id === 'ses-084')!, store().get().ruleset);
    removeAnnotation('ses-084', a.id);
    addAnnotation('ses-084', 2000, 'second');
    const after = buildReport(store().get().sessions.find((x) => x.id === 'ses-084')!, store().get().ruleset);
    expect(after).not.toBe(before);
    expect(after.session.annotations.map((x) => x.text)).toContain('second');
    expect(after.session.annotations.map((x) => x.text)).not.toContain('first');
  });

  it('a disconnect keeps partial data, marks the run interrupted and never resumes', async () => {
    const id = (await startSession())!;
    endRecording(id, 'interrupted', 'disconnected');
    const s = store().get().sessions.find((x) => x.id === id)!;
    expect(s.state).toBe('interrupted');
    expect(s.endReason).toBe('disconnected');
    await stopSession(id);
    expect(store().get().sessions.find((x) => x.id === id)!.state).toBe('interrupted');
  });

  it('a reload during recording becomes an interrupted session, not a silent resume', async () => {
    const id = (await startSession())!;
    recoverAfterReload();
    const s = store().get().sessions.find((x) => x.id === id)!;
    expect(s.state).toBe('interrupted');
    expect(s.endReason).toBe('browser-closed');
  });

  it('a failed publish keeps the local report and retry does not duplicate the page', async () => {
    setNotionFaults({ timeoutNext: true });
    const pubId = await publishSnapshot('ses-084', snapshot, 'k');
    expect(store().get().publications.find((p) => p.id === pubId)!.status).toBe('uncertain');
    expect(store().get().sessions.some((s) => s.id === 'ses-084')).toBe(true);
    await retryPublication(pubId);
    expect(store().get().publications.find((p) => p.id === pubId)!.status).toBe('published');
    expect(store().get().notion.pages).toHaveLength(1);
  });
});
