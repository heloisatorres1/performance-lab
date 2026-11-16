import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAppState } from '../data/state';
import { fmtClock } from '../domain/analysis';
import { build, device, scenario } from '../domain/catalog';
import { buildReport } from '../domain/report';
import type { Session } from '../domain/types';
import { VERDICT_LABEL, type VerdictState } from '../domain/verdict';
import { Card, Empty, StateBadge, VerdictBadge, fmt, fmtDate } from '../components/ui';

type GroupBy = 'device' | 'build' | 'scenario' | 'none';

export function ResultsPage() {
  const s = useAppState();
  const nav = useNavigate();
  const [group, setGroup] = useState<GroupBy>('device');
  const [mode, setMode] = useState<'all' | 'manual' | 'bot'>('all');
  const [complete, setComplete] = useState<'all' | 'complete' | 'incomplete'>('all');
  const [verdict, setVerdict] = useState<'all' | VerdictState>('all');

  const rows = useMemo(
    () =>
      s.sessions
        .filter((x) => x.state !== 'recording' && x.recordedMs > 0)
        .map((x) => ({ session: x, report: buildReport(x, s.ruleset) })),
    [s.sessions, s.ruleset],
  );
  const filtered = rows.filter(({ session: x, report: r }) => {
    if (mode !== 'all' && x.config.playMode !== mode) return false;
    const isComplete = x.state === 'complete';
    if (complete === 'complete' && !isComplete) return false;
    if (complete === 'incomplete' && isComplete) return false;
    if (verdict !== 'all' && r.verdict.state !== verdict) return false;
    return true;
  });
  const keyOf = (x: Session) => (group === 'device' ? x.config.deviceId : group === 'build' ? x.config.buildId : group === 'scenario' ? x.config.scenarioId : 'all');
  const labelOf = (k: string) => (group === 'device' ? device(k)?.name : group === 'build' ? `Build ${build(k)?.version}` : group === 'scenario' ? scenario(k)?.name : 'All sessions') ?? k;
  const groups = [...new Set(filtered.map((r) => keyOf(r.session)))];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Results</h1>
          <div className="meta">Session reports. Groups list sessions side by side; incompatible scenarios are never averaged into one score.</div>
        </div>
      </div>
      <div className="card row" style={{ marginBottom: 16, gap: 16 }}>
        <F id="group" label="Group by" value={group} onChange={(v) => setGroup(v as GroupBy)} options={[['device', 'Device'], ['build', 'Build'], ['scenario', 'Scenario'], ['none', 'No grouping']]} />
        <F id="mode" label="Play mode" value={mode} onChange={(v) => setMode(v as typeof mode)} options={[['all', 'All'], ['manual', 'Manual'], ['bot', 'Scripted bot']]} />
        <F id="complete" label="Completeness" value={complete} onChange={(v) => setComplete(v as typeof complete)} options={[['all', 'All'], ['complete', 'Complete'], ['incomplete', 'Interrupted / failed / cancelled']]} />
        <F id="verdict" label="Verdict" value={verdict} onChange={(v) => setVerdict(v as typeof verdict)} options={[['all', 'All'], ...(Object.entries(VERDICT_LABEL) as [string, string][])]} />
      </div>
      {!filtered.length && (
        <Card>
          <Empty title="No sessions match these filters" />
        </Card>
      )}
      <div className="stack">
        {groups.map((g) => {
          const items = filtered.filter((r) => keyOf(r.session) === g);
          const dev = group === 'device' ? device(g) : undefined;
          return (
            <Card key={g} className="flush" title={labelOf(g)} id={`grp-${g}`} actions={<span className="subtle">{items.length} session{items.length === 1 ? '' : 's'}</span>}>
              {dev && (
                <p className="subtle" style={{ padding: '0 16px 8px' }}>
                  Fictional profile · {dev.os} · {dev.cpu} · {dev.gpu} · {dev.ramGb} GB RAM · {dev.display}. Metrics below are per session: game-process memory, system CPU, battery sensor temperature.
                </p>
              )}
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Conditions</th>
                      <th className="r">Recorded</th>
                      <th className="r">Avg FPS</th>
                      <th className="r">p95 frame</th>
                      <th>State</th>
                      <th>Verdict</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map(({ session: x, report: r }) => (
                      <tr key={x.id} className="clickable" onClick={() => nav(`/results/${x.id}`)}>
                        <td>
                          <Link to={`/results/${x.id}`} onClick={(e) => e.stopPropagation()}>{x.name}</Link>
                          <div className="subtle">{build(x.config.buildId)?.version} · {device(x.config.deviceId)?.name}</div>
                        </td>
                        <td className="subtle">
                          {x.config.connection === 'usb' ? 'USB' : 'Wireless'} · {x.config.playMode === 'bot' ? 'Bot' : 'Manual'} · {x.config.capture === 'off' ? 'No capture' : x.config.capture === 'video' ? 'Video' : `Screenshots ${x.config.captureIntervalSec} s`}
                        </td>
                        <td className="r num">{fmtClock(x.recordedMs)}</td>
                        <td className="r num">{fmt(r.frames?.avgFps)}</td>
                        <td className="r num">{r.frames?.p95FrameMs != null ? `${fmt(r.frames.p95FrameMs)} ms` : '–'}</td>
                        <td><StateBadge state={x.state} /></td>
                        <td><VerdictBadge state={r.verdict.state} /></td>
                        <td className="subtle nowrap">{fmtDate(x.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}

function F({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div className="field" style={{ minWidth: 160 }}>
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  );
}
