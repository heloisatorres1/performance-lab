import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Info, Send, XCircle } from 'lucide-react';
import { publishSnapshot, setCompare } from '../data/actions';
import { comparisonSnapshot } from '../data/snapshots';
import { useAppState } from '../data/state';
import { sampleAt } from '../domain/align';
import { build } from '../domain/catalog';
import { compareVerdict, conditionChecks, deltas } from '../domain/compare';
import { windowedPercentile } from '../domain/analysis';
import { buildReport } from '../domain/report';
import { useLinkedCursor } from '../components/hooks';
import { TimeChart } from '../components/TimeChart';
import { Callout, Card, fmt, signed, useToast } from '../components/ui';

export function ComparePage() {
  const s = useAppState();
  const toast = useToast();
  const { baselineId, candidateId, acknowledged } = s.ui.compare;
  const eligible = s.sessions.filter((x) => x.recordedMs > 0 && x.state !== 'recording');
  const a = eligible.find((x) => x.id === baselineId);
  const b = eligible.find((x) => x.id === candidateId);
  const ra = useMemo(() => (a ? buildReport(a, s.ruleset) : null), [a, s.ruleset]);
  const rb = useMemo(() => (b ? buildReport(b, s.ruleset) : null), [b, s.ruleset]);
  const { cursor, onCursor } = useLinkedCursor(null);
  const [busy, setBusy] = useState(false);
  const dest = s.destinations.find((d) => d.id === s.ui.selectedDestinationId) ?? s.destinations[0];

  const pick = (id: string, label: string, value: string, onChange: (v: string) => void) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {eligible.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name} ({x.state})
          </option>
        ))}
      </select>
    </div>
  );

  const ready = ra && rb && a!.id !== b!.id;
  const checks = ready ? conditionChecks(ra, rb) : [];
  const ds = ready ? deltas(ra, rb, s.ruleset) : [];
  const verdict = ready ? compareVerdict(checks, ds, acknowledged) : null;
  const mismatches = checks.filter((c) => !c.match);
  const incomplete = ready && (ra.session.state !== 'complete' || rb.session.state !== 'complete');
  const end = ready ? Math.max(ra.session.recordedMs, rb.session.recordedMs) : 0;
  // Two dense per-frame traces hide each other; p95 per 10 s window (from raw frames) stays readable.
  const ftA = useMemo(() => (ra ? windowedPercentile(ra.tel.frameT, ra.tel.frameDt, ra.session.recordedMs, 10_000, 95) : []), [ra]);
  const ftB = useMemo(() => (rb ? windowedPercentile(rb.tel.frameT, rb.tel.frameDt, rb.session.recordedMs, 10_000, 95) : []), [rb]);
  const va = a ? build(a.config.buildId)?.version : '';
  const vb = b ? build(b.config.buildId)?.version : '';
  const snapshot = ready && verdict && verdict.state !== 'blocked' ? comparisonSnapshot(ra, rb, checks, ds, verdict, dest) : null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Compare performance</h1>
          <div className="meta">Baseline against candidate, with the conditions checked first.</div>
        </div>
      </div>
      <div className="split wide-side">
        <div className="stack">
          <Card>
            <div className="grid cols-2">
              {pick('baseline', 'Baseline', baselineId, (v) => setCompare({ baselineId: v }))}
              {pick('candidate', 'Candidate', candidateId, (v) => setCompare({ candidateId: v }))}
            </div>
          </Card>
          {!ready ? (
            <Callout>Choose two different sessions.</Callout>
          ) : (
            <>
              <Card title="Conditions" className="flush" actions={mismatches.length ? <span className="badge warn"><AlertTriangle size={14} aria-hidden /> {mismatches.length} differ</span> : <span className="badge good"><CheckCircle2 size={14} aria-hidden /> All match</span>}>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Condition</th><th>Baseline ({va})</th><th>Candidate ({vb})</th><th>Match</th></tr></thead>
                    <tbody>
                      {checks.map((c) => (
                        <tr key={c.label}>
                          <td>{c.label}</td>
                          <td className="subtle">{c.baseline}</td>
                          <td className="subtle">{c.candidate}</td>
                          <td>{c.match ? <span className="badge good"><CheckCircle2 size={13} aria-hidden /> Match</span> : <span className="badge warn"><XCircle size={13} aria-hidden /> Differs</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {mismatches.length > 0 && (
                  <div style={{ padding: 16 }}>
                    <label className="check">
                      <input type="checkbox" checked={acknowledged} onChange={(e) => setCompare({ acknowledged: e.target.checked })} />
                      I understand these runs are not directly comparable and want to see the differences anyway.
                    </label>
                  </div>
                )}
              </Card>
              {incomplete && <Callout tone="bad">At least one run is not complete. Differences include partial data and should not be read as a regression result.</Callout>}

              <Card title="Measured differences" className="flush">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Metric</th><th className="r">Baseline ({va})</th><th className="r">Candidate ({vb})</th><th className="r">Change</th><th>Threshold</th></tr></thead>
                    <tbody>
                      {ds.map((d) => (
                        <tr key={d.id}>
                          <td>{d.label} <span className="subtle">({d.better === 'higher' ? 'higher is better' : 'lower is better'})</span></td>
                          <td className="r num">{fmt(d.baseline, d.decimals)} {d.unit}</td>
                          <td className="r num">{fmt(d.candidate, d.decimals)} {d.unit}</td>
                          <td className="r num" style={{ color: d.exceeds ? 'var(--amber)' : undefined, fontWeight: 650 }}>{verdict?.state === 'blocked' ? 'hidden' : `${signed(d.delta, d.decimals)} ${d.unit}`}</td>
                          <td className="subtle">{d.limit !== undefined ? `${d.better === 'higher' ? 'drop' : 'rise'} ≤ ${d.limit} ${d.unit}${d.exceeds && verdict?.state !== 'blocked' ? ' · exceeded' : ''}` : 'reported only'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              {verdict && (
                <Callout tone={verdict.state === 'no-regression' || verdict.state === 'acknowledged-ok' ? 'good' : verdict.state === 'blocked' ? 'bad' : 'warn'}>
                  <strong>{verdict.state === 'blocked' ? 'Verdict blocked. ' : ''}</strong>
                  {verdict.reason}. One run each: this is not a statistical significance test, and it does not prove a cause.
                </Callout>
              )}

              <Card title="Frame rate and frame time over time">
                <div className="chart-stack">
                  <TimeChart
                    title="Frame rate"
                    unit="FPS, 1 s windows"
                    axisEndMs={end}
                    cursor={cursor}
                    onCursor={onCursor}
                    yMin={0}
                    yMax={70}
                    series={[
                      { id: 'a', label: `Baseline ${va}`, color: 'var(--m-frame)', points: ra.tel.series.fps ?? [], dashed: true },
                      { id: 'b', label: `Candidate ${vb}`, color: 'var(--m-fps)', points: rb.tel.series.fps ?? [] },
                    ]}
                    describe={(t) => `${va}: ${sampleAt(ra.tel.series.fps, t)?.v ?? '–'} FPS · ${vb}: ${sampleAt(rb.tel.series.fps, t)?.v ?? '–'} FPS`}
                  />
                  <TimeChart
                    title="p95 frame time"
                    unit="ms, per 10 s window"
                    axisEndMs={end}
                    cursor={cursor}
                    onCursor={onCursor}
                    yMin={0}
                    series={[
                      { id: 'a', label: `Baseline ${va}`, color: 'var(--m-frame)', points: ftA, dashed: true },
                      { id: 'b', label: `Candidate ${vb}`, color: 'var(--m-fps)', points: ftB },
                    ]}
                    describe={(t) => { const at = (pts: { t: number; v: number | null }[]) => pts.find((x) => x.t >= t)?.v ?? null; return `${va}: ${fmt(at(ftA))} ms · ${vb}: ${fmt(at(ftB))} ms`; }}
                  />
                </div>
                <p className="hint" style={{ marginTop: 8 }}>Two charts on one shared timeline instead of one chart with two y-axes. Baseline is dashed.</p>
              </Card>
            </>
          )}
        </div>

        <div className="stack">
          <Card title="Publish to Notion">
            <div className="stack-sm">
              <div className="field">
                <span className="label">Destination</span>
                <strong>{dest.name}</strong>
                <span className="subtle">{dest.kind} · <Link to="/publishing">change</Link></span>
              </div>
              {snapshot ? (
                <div className="card" style={{ background: 'var(--panel-2)' }}>
                  <h3 style={{ marginBottom: 8 }}>{snapshot.title}</h3>
                  <dl className="kv" style={{ fontSize: 13 }}>
                    {Object.entries(snapshot.properties).map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <h4 style={{ margin: '12px 0 6px' }}>Measured summary</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{snapshot.summary.map((x) => <li key={x}>{x}</li>)}</ul>
                  <h4 style={{ margin: '12px 0 6px' }}>Caveats</h4>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="muted">{snapshot.caveats.map((x) => <li key={x}>{x}</li>)}</ul>
                </div>
              ) : (
                <Callout>{verdict?.state === 'blocked' ? 'Acknowledge the condition differences to prepare a comparison page.' : 'Choose two sessions to preview.'}</Callout>
              )}
              <Callout tone="info" icon={<Info size={18} aria-hidden />}>Preview only · Nothing sent until you press Simulate publish.</Callout>
              <button
                className="btn primary big"
                disabled={!snapshot || busy}
                onClick={async () => {
                  if (!snapshot || !ra || !rb) return;
                  setBusy(true);
                  await publishSnapshot(`cmp:${ra.session.id}:${rb.session.id}`, snapshot, `${ra.session.id}|${rb.session.id}|${s.ruleset.version}`);
                  setBusy(false);
                  toast('Simulated publish finished. See Publishing for the delivery log.');
                }}
              >
                <Send size={18} aria-hidden /> {busy ? 'Publishing…' : 'Simulate publish'}
              </button>
              <p className="hint">Charts go as report images; raw data is attached separately. No request leaves this browser.</p>
            </div>
          </Card>
          <Card>
            <div className="stack-sm">
              <span className="row">{mismatches.length ? <AlertTriangle size={18} color="var(--amber)" aria-hidden /> : <CheckCircle2 size={18} color="var(--green)" aria-hidden />} {mismatches.length ? 'Configurations differ' : 'Configurations match'}</span>
              <span className="row muted" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}><Info size={18} aria-hidden style={{ flexShrink: 0, marginTop: 3 }} /> <span>Repeated runs recommended. Within-run percentiles are not run-to-run variation.</span></span>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
