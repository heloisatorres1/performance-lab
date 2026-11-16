import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleDashed, HelpCircle, RotateCcw, Send, XCircle } from 'lucide-react';
import { publishSnapshot, retryPublication, setDestination, setNotionFaults } from '../data/actions';
import { analysisKeyFor, reportSnapshot } from '../data/snapshots';
import { useAppState } from '../data/state';
import { buildReport } from '../domain/report';
import type { Publication, StepStatus } from '../integrations/publication';
import { Callout, Card, Empty, fmtDate, useToast } from '../components/ui';

const STATUS: Record<Publication['status'], { label: string; tone: string }> = {
  pending: { label: 'Publishing', tone: 'info' },
  published: { label: 'Published', tone: 'good' },
  partial: { label: 'Partially published', tone: 'warn' },
  failed: { label: 'Failed', tone: 'bad' },
  uncertain: { label: 'Uncertain · check before resending', tone: 'warn' },
};

const STEP_ICON: Record<StepStatus, React.ReactNode> = {
  done: <CheckCircle2 size={16} color="var(--green)" aria-label="Done" />,
  failed: <XCircle size={16} color="var(--red)" aria-label="Failed" />,
  uncertain: <HelpCircle size={16} color="var(--amber)" aria-label="Uncertain" />,
  pending: <CircleDashed size={16} color="var(--ink-3)" aria-label="Pending" />,
};

export function PublishingPage() {
  const s = useAppState();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const sourceId = params.get('source') ?? '';
  const dest = s.destinations.find((d) => d.id === s.ui.selectedDestinationId) ?? s.destinations[0];
  const session = s.sessions.find((x) => x.id === sourceId && x.recordedMs > 0 && x.state !== 'recording');
  const report = useMemo(() => (session ? buildReport(session, s.ruleset) : null), [session, s.ruleset]);
  const snapshot = report ? reportSnapshot(report, dest) : null;
  const [busy, setBusy] = useState(false);
  const f = s.notion.faults;
  const published = report ? s.publications.filter((p) => p.sourceId === report.session.id && p.status === 'published') : [];
  const stale = report && published.length > 0 && published.every((p) => p.analysisKey !== analysisKeyFor(report, s.ruleset));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Publishing</h1>
          <div className="meta">Review, then publish explicitly. Nothing is sent automatically when a run finishes. Reports stay saved locally even if publishing fails.</div>
        </div>
      </div>
      <div className="split wide-side">
        <div className="stack">
          <Card title="Preview">
            <div className="stack-sm">
              <div className="field">
                <label htmlFor="source">Report to publish</label>
                <select id="source" className="input" value={sourceId} onChange={(e) => setParams(e.target.value ? { source: e.target.value } : {})}>
                  <option value="">Choose a session…</option>
                  {s.sessions.filter((x) => x.recordedMs > 0 && x.state !== 'recording').map((x) => (
                    <option key={x.id} value={x.id}>{x.name} ({x.state})</option>
                  ))}
                </select>
                <span className="hint">Comparisons are published from <Link to="/compare">Compare</Link>.</span>
              </div>
              {snapshot && report ? (
                <>
                  {stale && <Callout tone="warn">The analysis changed since the last publish (for example a new ruleset or marker). Publishing again creates a new revision; the earlier page keeps what it showed.</Callout>}
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
                    <h4 style={{ margin: '12px 0 6px' }}>Summary</h4>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14 }}>{snapshot.summary.map((x) => <li key={x}>{x}</li>)}</ul>
                    <h4 style={{ margin: '12px 0 6px' }}>Caveats</h4>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }} className="muted">{snapshot.caveats.map((x) => <li key={x}>{x}</li>)}</ul>
                    <h4 style={{ margin: '12px 0 6px' }}>Attachments</h4>
                    <p className="subtle">Chart images: {snapshot.charts.join(', ')}. Raw data bundle attached separately. Link: {snapshot.reportLink}.</p>
                  </div>
                  <Callout tone="info">Charts become static images in Notion. Device serials, notifications and screen contents are not included.</Callout>
                  <button
                    className="btn primary big"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      await publishSnapshot(report.session.id, snapshot, analysisKeyFor(report, s.ruleset));
                      setBusy(false);
                      toast('Simulated publish finished.');
                    }}
                  >
                    <Send size={18} aria-hidden /> {busy ? 'Publishing…' : 'Simulate publish'}
                  </button>
                </>
              ) : (
                <Empty title="Choose a report to preview" />
              )}
            </div>
          </Card>

          <Card title="Publications" className="flush">
            {!s.publications.length ? (
              <Empty title="Nothing published yet" />
            ) : (
              <ul className="list" style={{ padding: '0 16px' }}>
                {s.publications.map((p) => (
                  <li key={p.id} style={{ display: 'block' }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <div>
                        <strong>{p.snapshot.title}</strong>
                        <div className="subtle">Revision {p.revision} · {p.destinationName} · {fmtDate(p.createdAt)}{p.pageId ? ` · ${p.pageId}` : ''}</div>
                      </div>
                      <div className="row">
                        <span className={`badge ${STATUS[p.status].tone}`}>{STATUS[p.status].label}</span>
                        {(p.status === 'failed' || p.status === 'partial' || p.status === 'uncertain') && (
                          <button className="btn small" onClick={() => void retryPublication(p.id)}>
                            <RotateCcw size={14} aria-hidden /> {p.status === 'uncertain' ? 'Check & retry' : 'Retry'}
                          </button>
                        )}
                      </div>
                    </div>
                    <ul className="list" style={{ marginTop: 6 }} aria-label="Delivery steps">
                      {p.steps.map((st) => (
                        <li key={st.id} style={{ padding: '4px 0', border: 0 }}>
                          {STEP_ICON[st.status]} <span>{st.label}</span> {st.resultId && <span className="subtle">{st.resultId}</span>}
                        </li>
                      ))}
                    </ul>
                    {p.attempts.length > 0 && (
                      <details style={{ marginTop: 4 }}>
                        <summary>Delivery log ({p.attempts.length})</summary>
                        <ul className="list">
                          {p.attempts.map((a, i) => (
                            <li key={i} style={{ fontSize: 13 }}>
                              <span className="subtle nowrap">{fmtDate(a.at)}</span> <strong>{a.step}</strong> <span>{a.outcome}: {a.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="stack">
          <Card title="Destination">
            <div className="stack-sm">
              <div className="field">
                <label htmlFor="dest">Notion database</label>
                <select id="dest" className="input" value={dest.id} onChange={(e) => setDestination(e.target.value)}>
                  {s.destinations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                <span className="hint">{dest.kind}. A live version authorises a destination on the server; tokens never reach the browser.</span>
              </div>
              <h3>Property mapping</h3>
              <table>
                <thead><tr><th>Report field</th><th>Notion property</th></tr></thead>
                <tbody>{dest.mapping.map((m) => <tr key={m.field}><td>{m.field}</td><td className="mono">{m.property}</td></tr>)}</tbody>
              </table>
            </div>
          </Card>
          <Card title="Demo: simulate a problem">
            <div className="stack-sm">
              <label className="check"><input type="checkbox" checked={f.permissionNext} onChange={(e) => setNotionFaults({ permissionNext: e.target.checked })} /> Next publish: no access (403)</label>
              <label className="check"><input type="checkbox" checked={f.rateLimitNext} onChange={(e) => setNotionFaults({ rateLimitNext: e.target.checked })} /> Next publish: rate limited (429)</label>
              <label className="check"><input type="checkbox" checked={f.timeoutNext} onChange={(e) => setNotionFaults({ timeoutNext: e.target.checked })} /> Next page times out (but is created)</label>
              <label className="check"><input type="checkbox" checked={f.assetFailNext} onChange={(e) => setNotionFaults({ assetFailNext: e.target.checked })} /> Next chart upload fails</label>
              <p className="hint">Each fault applies once. Retrying never re-creates a page that exists: an uncertain page is looked up first, and finished uploads are skipped.</p>
            </div>
          </Card>
          <Card title="Simulated Notion">
            <p className="subtle">
              {s.notion.pages.length} page{s.notion.pages.length === 1 ? '' : 's'}, {s.notion.assets.length} attachment{s.notion.assets.length === 1 ? '' : 's'} in the in-browser stand-in.
            </p>
            <p className="hint" style={{ marginTop: 6 }}><AlertTriangle size={13} aria-hidden /> No real Notion API request is made in this demo.</p>
          </Card>
        </div>
      </div>
    </>
  );
}
