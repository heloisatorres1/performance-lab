import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, Bookmark, Camera, Gamepad2, Hand, ImageOff, Radio, Square, Unplug, X } from 'lucide-react';
import { addAnnotation, endRecording, liveElapsedMs, setLiveSpeed, stopSession } from '../data/actions';
import { useAppState } from '../data/state';
import { fmtClock } from '../domain/analysis';
import { captureDataUrl } from '../domain/art';
import { build, device, METRICS } from '../domain/catalog';
import { activeMetrics, availability, simulate } from '../domain/simulate';
import type { MetricId, Session } from '../domain/types';
import { useLinkedCursor, useNow } from '../components/hooks';
import { CHART_COLOR, SessionCharts } from '../components/SessionCharts';
import { AvailabilityBadge, Callout, Card, Dialog, Empty, StateBadge, Stat } from '../components/ui';

export function LivePage() {
  const s = useAppState();
  const live = s.live;
  const session = live ? s.sessions.find((x) => x.id === live.sessionId) : s.sessions.find((x) => ['checking', 'ready', 'starting', 'stopping', 'processing'].includes(x.state));
  if (!session) {
    const last = s.sessions.find((x) => !x.fixture);
    return (
      <>
        <div className="page-head"><h1>Live Monitor</h1></div>
        <Card>
          <Empty icon={<Activity size={32} aria-hidden />} title="Nothing is recording">
            <p>Start a session from Sessions to watch simulated telemetry here.</p>
            <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
              <Link className="btn primary" to="/sessions">Set up a session</Link>
              {last && <Link className="btn" to={`/results/${last.id}`}>Last report: {last.name}</Link>}
            </div>
          </Empty>
        </Card>
      </>
    );
  }
  if (session.state !== 'recording') {
    return (
      <>
        <div className="page-head"><h1>Live Monitor</h1></div>
        <Card>
          <Empty title={`${session.name}`}>
            <div className="row" style={{ justifyContent: 'center' }}><StateBadge state={session.state} /></div>
            <p style={{ marginTop: 8 }}>{session.state === 'stopping' || session.state === 'processing' ? 'Flushing data and building the report…' : 'Preparing the simulated collector…'}</p>
          </Empty>
        </Card>
      </>
    );
  }
  return <Recording session={session} />;
}

function Recording({ session }: { session: Session }) {
  const s = useAppState();
  const nav = useNavigate();
  const now = useNow(250);
  const elapsed = liveElapsedMs(s, now);
  const dev = device(session.config.deviceId)!;
  const planned = session.config.durationSec * 1000;
  // The full simulation is generated once and revealed up to "now"; every stream is prefix-stable.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tel = useMemo(() => simulate(session, dev, planned), [session.id]);
  const { cursor, onCursor } = useLinkedCursor(null);
  const [marker, setMarker] = useState('');
  const [confirm, setConfirm] = useState<null | 'cancel' | 'disconnect'>(null);
  // Auto-stop, bot failure and progress saves run in the app shell (LiveDriver), on every page.

  const last = (m: MetricId) => {
    const arr = tel.series[m];
    if (!arr) return null;
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i].t <= elapsed) return arr[i];
    return null;
  };
  const lastFrame = (() => {
    let lo = 0;
    let hi = tel.frameT.length - 1;
    if (hi < 0 || tel.frameT[0] > elapsed) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (tel.frameT[mid] <= elapsed) lo = mid;
      else hi = mid - 1;
    }
    return tel.frameDt[lo];
  })();
  const captures = tel.captures.filter((c) => c.t <= elapsed);
  const latest = captures[captures.length - 1];
  const actualInterval = captures.length > 1 ? (captures[captures.length - 1].t - captures[0].t) / (captures.length - 1) / 1000 : null;
  const gapsSoFar = tel.gaps.filter((g) => g.fromMs <= elapsed);
  const captured = activeMetrics(session, dev);
  const avail = Object.fromEntries((Object.keys(METRICS) as MetricId[]).map((m) => [m, availability(session, dev, m)])) as Record<MetricId, ReturnType<typeof availability>>;
  const botEvents = tel.events.filter((e) => (e.kind === 'bot-action' || e.kind === 'bot-checkpoint') && e.t <= elapsed);
  const fps = last('fps');
  const mem = last('memory');
  const bat = last('battery');
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (addAnnotation(session.id, cursor ?? elapsed, marker)) setMarker('');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="row" style={{ gap: 12 }}>
            <span className="rec-dot" aria-hidden /> Recording · Orbit Garden <span className="subtle">Build {build(session.config.buildId)?.version}</span>
          </h1>
          <div className="row" style={{ marginTop: 8, minWidth: 320 }}>
            <span className="num">
              Elapsed <strong>{fmtClock(elapsed)}</strong> / {fmtClock(planned)}
            </span>
            <div className="progress" role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((elapsed / planned) * 100)}>
              <span style={{ width: `${(elapsed / planned) * 100}%` }} />
            </div>
            <span className="subtle num">{fmtClock(planned - elapsed)} remaining</span>
          </div>
        </div>
        <div className="stack-sm" style={{ alignItems: 'flex-end' }}>
          <div className="chips">
            <span className="chip"><Radio size={14} aria-hidden /> {session.config.connection === 'usb' ? 'USB' : 'Wireless'}</span>
            <span className="chip">{session.config.playMode === 'bot' ? <Gamepad2 size={14} aria-hidden /> : <Hand size={14} aria-hidden />} {session.config.playMode === 'bot' ? 'Scripted bot' : 'Manual'}</span>
            <span className="chip"><Camera size={14} aria-hidden /> {session.config.capture === 'off' ? 'Capture off' : session.config.capture === 'video' ? 'Video' : `Screenshots ${session.config.captureIntervalSec} s`}</span>
          </div>
          <div className="row" role="group" aria-label="Simulation speed">
            <span className="subtle">Simulation speed</span>
            {[1, 10, 60].map((x) => (
              <button key={x} className={`btn small ${s.live?.speed === x ? 'primary' : ''}`} aria-pressed={s.live?.speed === x} onClick={() => setLiveSpeed(x)}>
                {x}×
              </button>
            ))}
          </div>
        </div>
      </div>
      <Callout tone="info">Simulated recording. Values come from the deterministic demo simulator, not from a device.</Callout>

      <div className="grid cols-4" style={{ margin: '16px 0' }}>
        <Stat label={<><span className="swatch" style={{ background: CHART_COLOR.fps }} aria-hidden /> FPS</>} value={fps?.v ?? '–'} unit="FPS" foot="last 1 s window" />
        <Stat label={<><span className="swatch" style={{ background: CHART_COLOR.frameTime }} aria-hidden /> Frame time</>} value={lastFrame === null ? '–' : lastFrame.toFixed(1)} unit="ms" foot="latest frame" />
        <Stat label={<><span className="swatch" style={{ background: CHART_COLOR.memory }} aria-hidden /> Memory (PSS)</>} value={mem?.v != null ? (mem.v / 1024).toFixed(2) : '–'} unit="GB" foot={mem?.v != null ? `${mem.v} MB` : 'not captured'} />
        <Stat label={<><span className="swatch" style={{ background: CHART_COLOR.battery }} aria-hidden /> Battery</>} value={bat?.v ?? '–'} unit="%" foot={tel.charging.find((c) => c.t <= elapsed && c.charging) ? 'external power reported' : 'on battery'} />
      </div>

      <div className="split">
        <Card>
          <SessionCharts
            tel={tel}
            dataEndMs={elapsed}
            axisEndMs={planned}
            availability={avail}
            captured={captured}
            ruleset={s.ruleset}
            targetFps={session.config.targetFps}
            warmupMs={session.config.warmupSec * 1000}
            cursor={cursor}
            onCursor={onCursor}
            markers={session.annotations.map((a) => ({ t: a.t, label: a.text }))}
            initial={['fps', 'frameTime', 'memory']}
            compact
          />
        </Card>
        <div className="stack">
          <Card title={latest ? `Latest ${session.config.capture === 'video' ? 'video frame' : 'screenshot'} · ${fmtClock(latest.t)}` : 'Latest capture'} actions={latest && <span className="subtle num">{((elapsed - latest.t) / 1000).toFixed(1)} s old</span>}>
            {session.config.capture === 'off' ? (
              <div className="evidence-empty"><div><ImageOff aria-hidden /><p>Screen capture is off.</p></div></div>
            ) : latest ? (
              <>
                <img className="evidence-img" src={captureDataUrl(latest, session.seed)} alt={`Simulated capture at ${fmtClock(latest.t, true)}`} />
                <p className="hint" style={{ marginTop: 6 }}>Last captured image with its timestamp. Not a live feed.</p>
              </>
            ) : (
              <div className="evidence-empty"><p>Waiting for the first capture…</p></div>
            )}
          </Card>
          <Card title="Add marker">
            <form className="row" onSubmit={add}>
              <label htmlFor="marker" className="sr-only">Describe this moment</label>
              <input id="marker" className="input" style={{ flex: 1 }} placeholder="Describe this moment…" value={marker} maxLength={200} onChange={(e) => setMarker(e.target.value)} />
              <button className="btn primary" disabled={!marker.trim()}>Add marker</button>
            </form>
            <p className="hint" style={{ marginTop: 6 }}>Marks {cursor !== null ? `the selected time ${fmtClock(cursor, true)}` : 'the current time'}. Recording continues.</p>
            <ul className="list" style={{ marginTop: 8 }}>
              {session.annotations.map((a) => (
                <li key={a.id}><Bookmark size={16} color="var(--amber)" aria-hidden /> <span style={{ flex: 1 }}>{a.text}</span> <span className="subtle num">{fmtClock(a.t)}</span></li>
              ))}
            </ul>
          </Card>
          {session.config.playMode === 'bot' && (
            <Card title="Bot progress">
              <ul className="list">
                {botEvents.slice(-5).map((e, i) => (
                  <li key={i}><span className="subtle num">{fmtClock(e.t)}</span> {e.kind === 'bot-checkpoint' ? <strong>✓ {e.label}</strong> : e.label}</li>
                ))}
                {!botEvents.length && <li className="subtle">Waiting for the first action…</li>}
              </ul>
            </Card>
          )}
        </div>
      </div>

      <div className="bottom-bar">
        <Activity size={18} aria-hidden />
        <span className="num">Telemetry {session.config.sampleHz} Hz · Gaps {gapsSoFar.length}</span>
        {session.config.capture === 'screenshots' && <span className="num">· Screenshots {session.config.captureIntervalSec} s requested, {actualInterval ? `${actualInterval.toFixed(2)} s actual` : '–'}</span>}
        {session.config.capture !== 'off' && <span className="row" style={{ color: 'var(--amber)' }}><AlertTriangle size={16} aria-hidden /> Screen capture may affect performance</span>}
        {(['gpu', 'current'] as MetricId[]).filter((m) => avail[m] !== 'supported').map((m) => (
          <span key={m} className="row"><span className="subtle">{METRICS[m].label}</span> <AvailabilityBadge a={avail[m]} /></span>
        ))}
        <span style={{ flex: 1 }} />
        <button className="btn ghost" onClick={() => setConfirm('disconnect')}><Unplug size={16} aria-hidden /> Simulate disconnect</button>
        <button className="btn ghost" onClick={() => setConfirm('cancel')}><X size={16} aria-hidden /> Cancel</button>
        <button className="btn primary" onClick={() => void stopSession(session.id).then(() => nav(`/results/${session.id}`))}>
          <Square size={16} aria-hidden /> Stop &amp; save
        </button>
      </div>

      {confirm && (
        <Dialog title={confirm === 'cancel' ? 'Cancel this recording?' : 'Simulate a device disconnect?'} onClose={() => setConfirm(null)}>
          <div className="stack">
            <p className="muted">
              {confirm === 'cancel'
                ? 'Data recorded so far is kept, but a cancelled session is not a benchmark and gets no verdict.'
                : 'The session becomes Interrupted. Partial data is kept and cannot pass. You can start a continuation, which keeps the gap.'}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirm(null)}>Keep recording</button>
              <button
                className="btn primary"
                onClick={() => {
                  endRecording(session.id, confirm === 'cancel' ? 'cancelled' : 'interrupted', confirm === 'cancel' ? 'cancelled' : 'disconnected');
                  nav(`/results/${session.id}`);
                }}
              >
                {confirm === 'cancel' ? 'Cancel recording' : 'Disconnect'}
              </button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
