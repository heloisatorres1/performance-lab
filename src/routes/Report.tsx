import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BatteryMedium, Bookmark, Camera, Clock, Download, ExternalLink, FileJson, GitCompareArrows, Hand, Gamepad2, Radio, RotateCcw, Scissors, Trash2 } from 'lucide-react';
import { addAnnotation, deleteSession, prepareContinuation, removeAnnotation, setCompare } from '../data/actions';
import { useAppState } from '../data/state';
import { ALIGN_TOLERANCE_MS, CLOCK_UNCERTAINTY_MS } from '../domain/align';
import { fmtClock, mbToGb } from '../domain/analysis';
import { METRICS, build, device } from '../domain/catalog';
import { DEFINITIONS, exportBundle, framesCsv, manifest, telemetryCsv } from '../domain/export';
import type { MetricId } from '../domain/types';
import { Evidence } from '../components/Evidence';
import { useLinkedCursor, useReport } from '../components/hooks';
import { CHART_COLOR, SessionCharts } from '../components/SessionCharts';
import { AvailabilityBadge, Callout, Card, Dialog, Empty, StateBadge, Stat, VerdictBadge, download, fmt, fmtDate, useToast } from '../components/ui';

export function ReportPage() {
  const { id } = useParams();
  const s = useAppState();
  const nav = useNavigate();
  const toast = useToast();
  const r = useReport(id);
  const session = s.sessions.find((x) => x.id === id);
  const firstMarker = session?.annotations[0]?.t ?? null;
  const { cursor, selected, setSelected, onCursor } = useLinkedCursor(firstMarker);
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (!session) {
    return (
      <Card>
        <Empty title="Session not found">
          <Link to="/results">Back to results</Link>
        </Empty>
      </Card>
    );
  }
  if (session.state === 'recording') {
    return (
      <Card>
        <Empty title="This session is still recording">
          <Link to="/live">Open Live Monitor</Link>
        </Empty>
      </Card>
    );
  }
  if (!r) {
    return (
      <Card>
        <Empty title={session.name}>
          <StateBadge state={session.state} />
          <p style={{ marginTop: 8 }}>No data was recorded before the session ended.</p>
        </Empty>
      </Card>
    );
  }
  const c = session.config;
  const f = r.frames;
  const b = r.battery;
  const caps = r.tel.captures;
  const intervals = caps.slice(1).map((x, i) => x.t - caps[i].t);
  const meanInterval = intervals.length ? intervals.reduce((a, x) => a + x, 0) / intervals.length / 1000 : null;
  const maxInterval = intervals.length ? Math.max(...intervals) / 1000 : null;
  const markers = [...session.annotations.map((a) => ({ t: a.t, label: a.text })), ...r.tel.events.filter((e) => e.kind === 'bot-failure' || e.kind === 'disconnect' || e.kind === 'load-ready').map((e) => ({ t: e.t, label: e.label }))];

  const exportZip = () => {
    const bundle = exportBundle(r);
    download(bundle.name, bundle.bytes as BlobPart, 'application/zip');
    toast(`Exported ${bundle.name} (${bundle.entries.length} files).`);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <div className="row">
            <h1>Session report</h1>
            <VerdictBadge state={r.verdict.state} big />
          </div>
          <div className="meta">
            {r.title} · {device(c.deviceId)?.name} · {fmtDate(session.startedAtWall ?? session.createdAt)}
          </div>
          <div className="chips" style={{ marginTop: 10 }}>
            <span className="chip"><Radio size={14} aria-hidden /> {c.connection === 'usb' ? 'USB' : 'Wireless'}</span>
            <span className="chip">{c.playMode === 'bot' ? <Gamepad2 size={14} aria-hidden /> : <Hand size={14} aria-hidden />} {c.playMode === 'bot' ? 'Scripted bot' : 'Manual'}</span>
            <span className="chip"><Camera size={14} aria-hidden /> {c.capture === 'off' ? 'Capture off' : c.capture === 'video' ? 'Video' : `Screenshots ${c.captureIntervalSec} s`}</span>
            <span className="chip"><Clock size={14} aria-hidden /> Recorded {fmtClock(session.recordedMs)} of {fmtClock(c.durationSec * 1000)}</span>
            <span className="chip"><Scissors size={14} aria-hidden /> Warm-up {c.warmupSec} s excluded from frame stats</span>
            <StateBadge state={session.state} />
          </div>
        </div>
        <div className="row">
          <button className="btn primary" onClick={exportZip}><Download size={16} aria-hidden /> Export report</button>
          <button className="btn" onClick={() => { setCompare({ candidateId: session.id }); nav('/compare'); }}><GitCompareArrows size={16} aria-hidden /> Compare</button>
          <Link className="btn" to={`/publishing?source=${session.id}`}><ExternalLink size={16} aria-hidden /> Preview Notion</Link>
        </div>
      </div>

      <div className="stack" style={{ marginBottom: 16 }}>
        <Callout tone={r.verdict.state === 'within' ? 'good' : r.verdict.state === 'review' ? 'warn' : r.verdict.state === 'incomplete' ? 'bad' : 'neutral'}>
          <strong>{r.verdict.state === 'review' ? 'Review needed: ' : ''}</strong>
          {r.verdict.reason} <span className="subtle">Ruleset {r.verdict.rulesetLabel}. A QA signal, not a release approval.</span>
        </Callout>
        {session.continuationOf && <Callout tone="info">Continuation of <Link to={`/results/${session.continuationOf.sessionId}`}>an interrupted session</Link>. {session.continuationOf.gapNote}</Callout>}
        {session.state === 'interrupted' && (
          <Callout tone="warn">
            Recording stopped at {fmtClock(session.recordedMs)} ({session.endReason === 'browser-closed' ? 'the page was closed' : 'device disconnected'}). Partial data is kept below.{' '}
            <button className="btn small" onClick={() => { prepareContinuation(session.id); nav('/sessions'); }}><RotateCcw size={14} aria-hidden /> Start a continuation</button>
          </Callout>
        )}
        {session.endReason === 'bot-failed' && <Callout tone="bad">{r.tel.events.find((e) => e.kind === 'bot-failure')?.label}. This is a bot failure, separate from the device and collector, which kept working.</Callout>}
        {c.capture !== 'off' && <Callout tone="warn">Screen capture was enabled; compare only with sessions using the same capture settings.</Callout>}
        <Callout tone="info">Simulated data generated by the demo simulator (seed {session.seed}). Not measured on a real device.</Callout>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <Stat label="Average frame rate" value={fmt(f?.avgFps)} unit="FPS" color="var(--link)" foot={f ? `${f.frames.toLocaleString()} frames ÷ ${f.validSeconds.toFixed(0)} valid s` : 'Not captured'} />
        <Stat label="p95 frame time" value={fmt(f?.p95FrameMs)} unit="ms" color="var(--violet)" foot={f ? `p50 ${fmt(f.p50FrameMs)} · p99 ${fmt(f.p99FrameMs)} · max ${fmt(f.maxFrameMs)} ms` : ''} />
        <Stat label="Time below target" value={fmt(f?.belowTarget.pct)} unit="%" color="var(--amber)" foot={f ? `1 s windows below ${f.belowTarget.thresholdFps} FPS (target ${c.targetFps}): ${f.belowTarget.windowsBelow} of ${f.belowTarget.windowsEvaluated}` : ''} />
        <Stat
          label="Battery (full session)"
          icon={<BatteryMedium size={16} aria-hidden />}
          value={b.startLevel !== null ? `${b.startLevel}% → ${b.endLevel}%` : '–'}
          color="var(--green)"
          foot={b.status === 'ok' ? `${b.dropPp} percentage points` : b.status === 'charging' ? 'Charging: discharge not analysed' : 'Not captured'}
        />
      </div>

      <div className="split wide-side">
        <Card>
          <SessionCharts
            tel={r.tel}
            dataEndMs={session.recordedMs}
            axisEndMs={session.recordedMs}
            availability={r.availability}
            captured={r.captured}
            ruleset={s.ruleset}
            targetFps={c.targetFps}
            warmupMs={c.warmupSec * 1000}
            cursor={cursor}
            onCursor={onCursor}
            markers={markers}
            initial={['fps', 'frameTime', 'temperature', 'memory']}
          />
        </Card>
        <div className="stack">
          <Card title="Evidence">
            <Evidence captures={caps} gaps={r.tel.gaps} events={r.tel.events} mode={c.capture} seed={session.seed} t={cursor} onSelect={(t) => setSelected(t)} />
          </Card>
          <Card title="Markers">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                if (selected === null) return;
                if (addAnnotation(session.id, selected, note)) setNote('');
              }}
            >
              <label htmlFor="note" className="sr-only">Marker text</label>
              <input id="note" className="input" style={{ flex: 1 }} value={note} maxLength={200} placeholder={selected === null ? 'Select a time first' : `Note at ${fmtClock(selected, true)}`} onChange={(e) => setNote(e.target.value)} />
              <button className="btn" disabled={selected === null || !note.trim()}>Add</button>
            </form>
            <ul className="list" style={{ marginTop: 8 }}>
              {session.annotations.map((a) => (
                <li key={a.id}>
                  <Bookmark size={16} color="var(--amber)" aria-hidden />
                  <button className="btn ghost small" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => setSelected(a.t)}>{a.text}</button>
                  <span className="subtle num">{fmtClock(a.t, true)}</span>
                  <button className="icon-btn" style={{ width: 28, height: 28 }} aria-label={`Remove marker ${a.text}`} onClick={() => removeAnnotation(session.id, a.id)}><Trash2 size={14} /></button>
                </li>
              ))}
              {r.tel.events.filter((e) => e.kind === 'scene' || e.kind === 'bot-checkpoint').slice(0, 6).map((e, i) => (
                <li key={`e${i}`}>
                  <span className="badge violet">{e.kind === 'scene' ? 'Event' : 'Checkpoint'}</span>
                  <button className="btn ghost small" style={{ flex: 1, justifyContent: 'flex-start' }} onClick={() => setSelected(e.t)}>{e.label}</button>
                  <span className="subtle num">{fmtClock(e.t, true)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="Battery" actions={<span className="subtle">{b.window.label}</span>}>
          {b.status === 'ok' ? (
            <div className="stack-sm">
              <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--green)' }}>{b.dropPp} percentage points / {b.durationMin.toFixed(0)} min</p>
              <p className="muted">{fmt(b.ppPerHour)} percentage points/hour · observed interval, not a battery-life prediction</p>
              <p className="subtle">Sensor granularity {b.granularityPct}%. Endpoint changes are coarse over short sessions.</p>
              <dl className="kv">
                <dt>Charge consumed</dt><dd>{b.chargeConsumedMah !== null ? `${b.chargeConsumedMah.toFixed(0)} mAh (charge counter, µAh → mAh)` : 'unavailable (charge counter not supported)'}</dd>
                <dt>Average power</dt><dd>{b.avgPowerW !== null ? `${b.avgPowerW.toFixed(2)} W` : 'unavailable'}</dd>
                <dt>Energy</dt><dd>{b.energyWh !== null ? `${b.energyWh.toFixed(3)} Wh (integrated, gaps skipped)` : 'unavailable'}</dd>
              </dl>
              <p className="hint">{b.powerNote}</p>
            </div>
          ) : (
            <Callout tone={b.status === 'charging' ? 'warn' : 'neutral'}>{b.powerNote}</Callout>
          )}
        </Card>
        <Card title="Rules" actions={<span className="subtle">{r.verdict.rulesetLabel}</span>} className="flush">
          {r.verdict.rules.length ? (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Rule</th><th className="r">Observed</th><th className="r">Limit</th><th>Result</th></tr></thead>
                <tbody>
                  {r.verdict.rules.map((x) => (
                    <tr key={x.id}>
                      <td>{x.label}</td>
                      <td className="r num">{x.observed === null ? 'n/a' : `${fmt(x.observed)} ${x.unit}`}</td>
                      <td className="r num">{x.comparator} {x.limit} {x.unit}</td>
                      <td>{x.status === 'pass' ? <span className="badge good">Pass</span> : x.status === 'fail' ? <span className="badge warn">Exceeded</span> : <span className="badge outline">Not evaluated</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="subtle" style={{ padding: '8px 16px 14px' }}>Window {r.verdict.window} · coverage {(r.verdict.coverage * 100).toFixed(1)}%</p>
            </div>
          ) : (
            <p className="muted" style={{ padding: '0 16px 16px' }}>No rules evaluated: {r.verdict.reason}</p>
          )}
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="Diagnostics">
          <dl className="kv">
            <dt>Frame coverage</dt><dd>{f ? `${(f.coverage * 100).toFixed(1)}% of the analysis window` : 'n/a'}</dd>
            <dt>Telemetry gaps</dt><dd>{r.tel.gaps.filter((g) => g.stream === 'telemetry').map((g) => `${fmtClock(g.fromMs)}–${fmtClock(g.toMs)}`).join(', ') || 'none'}</dd>
            <dt>Capture gaps</dt><dd>{r.tel.gaps.filter((g) => g.stream === 'capture').map((g) => `${fmtClock(g.fromMs)}–${fmtClock(g.toMs)}`).join(', ') || 'none'}</dd>
            <dt>Captures</dt><dd>{caps.length ? `${caps.length} · mean interval ${meanInterval?.toFixed(2)} s · max ${maxInterval?.toFixed(1)} s${c.capture === 'screenshots' ? ` (requested ${c.captureIntervalSec} s)` : ''}` : 'none'}</dd>
            <dt>Alignment</dt><dd>±{ALIGN_TOLERANCE_MS / 1000} s tolerance, ±{CLOCK_UNCERTAINTY_MS} ms clock uncertainty</dd>
            <dt>Slow frames</dt><dd>{f ? `${f.slowFrames} over ${f.slowFrameThresholdMs.toFixed(1)} ms` : 'n/a'}</dd>
            <dt>Peak memory</dt><dd>{r.memory?.max != null ? `${r.memory.max} MB (${mbToGb(r.memory.max).toFixed(2)} GB)` : 'unavailable'}</dd>
            {r.load && <><dt>Load time</dt><dd>{r.load.ms !== null ? `${(r.load.ms / 1000).toFixed(1)} s (${r.load.note})` : r.load.note}</dd></>}
            <dt>Collectors</dt><dd className="subtle">{Object.values(session.collectorVersions).join(' · ')}</dd>
            <dt>Build / device</dt><dd className="subtle">{build(c.buildId)?.version} · {device(c.deviceId)?.os}</dd>
          </dl>
        </Card>
        <Card title="Metric sources" className="flush">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Metric</th><th>Status</th><th>Scope · source</th></tr></thead>
              <tbody>
                {(Object.keys(METRICS) as MetricId[]).map((m) => (
                  <tr key={m}>
                    <td className="nowrap">{m in CHART_COLOR && <span className="swatch" style={{ background: CHART_COLOR[m as keyof typeof CHART_COLOR], marginRight: 6 }} aria-hidden />}{METRICS[m].label} <span className="subtle">({METRICS[m].unit})</span></td>
                    <td>{r.availability[m] === 'supported' && !r.captured.includes(m) ? <span className="badge outline">Not selected</span> : <AvailabilityBadge a={r.availability[m]} />}</td>
                    <td className="subtle">{METRICS[m].scope} · {METRICS[m].source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <Card title="Definitions">
          <ul className="list">{Object.values(DEFINITIONS).map((d) => <li key={d} className="muted" style={{ fontSize: 14 }}>{d}</li>)}</ul>
        </Card>
        <Card title="Raw data">
          <div className="stack-sm">
            <p className="muted">The bundle has a standalone HTML report, the manifest, CSV streams with explicit timestamps and units, and every capture as a relative file.</p>
            <div className="row">
              <button className="btn primary" onClick={exportZip}><Download size={16} aria-hidden /> Bundle (.zip)</button>
              <button className="btn" onClick={() => download(`${session.id}-manifest.json`, JSON.stringify(manifest(r), null, 2), 'application/json')}><FileJson size={16} aria-hidden /> Manifest</button>
              <button className="btn" onClick={() => download(`${session.id}-telemetry.csv`, telemetryCsv(r), 'text/csv')}>Telemetry CSV</button>
              <button className="btn" onClick={() => download(`${session.id}-frames.csv`, framesCsv(r), 'text/csv')}>Frames CSV</button>
            </div>
            <hr style={{ border: 0, borderTop: '1px solid var(--border)', width: '100%' }} />
            <button className="btn danger" style={{ alignSelf: 'flex-start' }} onClick={() => setConfirmDelete(true)}><Trash2 size={16} aria-hidden /> Delete session</button>
          </div>
        </Card>
      </div>
      {confirmDelete && (
        <Dialog title="Delete this session?" onClose={() => setConfirmDelete(false)}>
          <div className="stack">
            <p className="muted">The session and its report are removed from this browser. Publications already sent are not changed.</p>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setConfirmDelete(false)}>Keep</button>
              <button className="btn primary" onClick={() => { deleteSession(session.id); nav('/results'); }}>Delete</button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
