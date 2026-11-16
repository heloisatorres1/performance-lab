import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, BatteryMedium, Camera, CheckCircle2, CircleDashed, Gamepad2, Info, Play, Radio, Ruler, XCircle } from 'lucide-react';
import { setBotFailNext, setDraft, setupProblems, startSession } from '../data/actions';
import { useAppState } from '../data/state';
import { captureDataUrl } from '../domain/art';
import { BOT_SCRIPTS, BUILDS, DEVICES, METRICS, SCENARIOS, SELECTABLE_METRICS, device } from '../domain/catalog';
import { readiness } from '../domain/readiness';
import type { CaptureMode, Connection, MetricId, PlayMode } from '../domain/types';
import { AvailabilityBadge, Callout, Card, StateBadge, fmtDate } from '../components/ui';
import { CHART_COLOR } from '../components/SessionCharts';

function Seg<T extends string>({ legend, icon, name, value, options, onChange }: { legend: string; icon: React.ReactNode; name: string; value: T; options: { v: T; label: string; disabled?: string }[]; onChange: (v: T) => void }) {
  return (
    <fieldset className="seg">
      <legend>
        {icon}
        {legend}
      </legend>
      <div className="seg-options">
        {options.map((o) => (
          <label key={o.v} className="seg-opt" title={o.disabled}>
            <input type="radio" name={name} value={o.v} checked={value === o.v} disabled={!!o.disabled} onChange={() => onChange(o.v)} aria-describedby={o.disabled ? `${name}-${o.v}-why` : undefined} />
            <span>{o.label}</span>
            {o.disabled && (
              <span id={`${name}-${o.v}-why`} className="sr-only">
                Unavailable: {o.disabled}
              </span>
            )}
          </label>
        ))}
      </div>
      {options.filter((o) => o.disabled).map((o) => (
        <p key={o.v} className="hint" style={{ marginTop: 6 }}>
          {o.label}: {o.disabled}
        </p>
      ))}
    </fieldset>
  );
}

const STATUS_ICON = { pass: <CheckCircle2 size={20} color="var(--green)" aria-label="Pass" />, warn: <AlertTriangle size={20} color="var(--amber)" aria-label="Warning" />, fail: <XCircle size={20} color="var(--red)" aria-label="Failed" />, na: <CircleDashed size={20} color="var(--ink-3)" aria-label="Not applicable" /> };

export function SessionsPage() {
  const s = useAppState();
  const nav = useNavigate();
  const c = s.ui.draft;
  const d = device(c.deviceId)!;
  const checks = readiness(c);
  const problems = setupProblems(c);
  const [starting, setStarting] = useState(false);
  const capOpts = (['off', 'screenshots', 'video'] as CaptureMode[]).map((v) => ({
    v,
    label: v === 'off' ? 'Off' : v === 'screenshots' ? 'Screenshots' : 'Video',
    disabled: d.captures[c.connection]?.includes(v) ? undefined : `not supported over ${c.connection === 'usb' ? 'USB' : 'wireless'} on this device`,
  }));
  const start = async () => {
    setStarting(true);
    const id = await startSession();
    setStarting(false);
    if (id) nav('/live');
  };
  const recent = s.sessions.slice(0, 5);
  const preview = { index: 3, t: 0, scene: 'garden' as const, level: 4 };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Set up a performance session</h1>
          <div className="meta">Choose how to connect, play and capture. Each choice is independent; the device profile decides what is possible.</div>
        </div>
      </div>
      {s.ui.continuationOf && <div style={{ marginBottom: 16 }}><Callout tone="info">This is a continuation session. {s.ui.continuationOf.gapNote}</Callout></div>}
      <div className="split wide-side">
        <div className="stack">
          <Card>
            <div className="stack">
              <div className="grid cols-4" style={{ alignItems: 'end' }}>
                <div className="row" style={{ gap: 12 }}>
                  <img src={captureDataUrl(preview, 7)} alt="" width={44} height={78} style={{ borderRadius: 6 }} />
                  <div>
                    <div className="subtle">Game</div>
                    <strong>Orbit Garden</strong>
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="build">Build</label>
                  <select id="build" className="input" value={c.buildId} onChange={(e) => setDraft({ buildId: e.target.value })}>
                    {BUILDS.map((b) => <option key={b.id} value={b.id}>{b.version}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="device">Device</label>
                  <select id="device" className="input" value={c.deviceId} onChange={(e) => setDraft({ deviceId: e.target.value })}>
                    {DEVICES.map((x) => <option key={x.id} value={x.id}>{x.name}{x.collector === 'not-implemented' ? ' (not implemented)' : ''}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="scenario">Scenario</label>
                  <select id="scenario" className="input" value={c.scenarioId} onChange={(e) => setDraft({ scenarioId: e.target.value })}>
                    {SCENARIOS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </div>
              </div>
              <p className="hint">{SCENARIOS.find((x) => x.id === c.scenarioId)?.description}</p>

              <div className="grid cols-3">
                <Seg<Connection> legend="Connection" icon={<Radio size={18} aria-hidden />} name="connection" value={c.connection} onChange={(v) => setDraft({ connection: v })} options={(['usb', 'wireless'] as Connection[]).map((v) => ({ v, label: v === 'usb' ? 'USB' : 'Wireless', disabled: d.connections.includes(v) ? undefined : 'not available on this device' }))} />
                <Seg<PlayMode> legend="Play mode" icon={<Gamepad2 size={18} aria-hidden />} name="play" value={c.playMode} onChange={(v) => setDraft({ playMode: v })} options={[{ v: 'manual', label: 'Manual' }, { v: 'bot', label: 'Scripted bot', disabled: d.botSupported ? undefined : 'no automation support on this device' }]} />
                <Seg<CaptureMode> legend="Screen capture" icon={<Camera size={18} aria-hidden />} name="capture" value={c.capture} onChange={(v) => setDraft({ capture: v })} options={capOpts} />
              </div>
              {c.connection === 'wireless' && <Callout tone="warn">{d.wirelessNote} Wireless and screen capture also use battery.</Callout>}
              {c.playMode === 'bot' && (
                <div className="grid cols-2">
                  <div className="field">
                    <label htmlFor="bot">Bot script</label>
                    <select id="bot" className="input" value={c.botScriptId} onChange={(e) => setDraft({ botScriptId: e.target.value })}>
                      {BOT_SCRIPTS.map((b) => <option key={b.id} value={b.id}>{b.name} v{b.version} (builds {b.buildRange[0]}–{b.buildRange[1]})</option>)}
                    </select>
                    <span className="hint">A repeatable scenario runner with fixed seed and checkpoints. It does not understand arbitrary games.</span>
                  </div>
                  <label className="check" style={{ alignSelf: 'center' }}>
                    <input type="checkbox" checked={s.ui.botFailNext} onChange={(e) => setBotFailNext(e.target.checked)} />
                    Demo: next bot run misses a checkpoint
                  </label>
                </div>
              )}

              <div className="grid cols-4">
                <Select id="duration" label="Duration" value={c.durationSec} onChange={(v) => setDraft({ durationSec: v })} options={[[60, '1 min'], [300, '5 min'], [600, '10 min'], [1200, '20 min'], [1800, '30 min']]} />
                <Select id="warmup" label="Warm-up (excluded)" value={c.warmupSec} onChange={(v) => setDraft({ warmupSec: v })} options={[[0, 'None'], [10, '10 s'], [30, '30 s'], [60, '60 s'], [120, '2 min']]} />
                <Select id="target" label="Target" value={c.targetFps} onChange={(v) => setDraft({ targetFps: v })} options={[[30, '30 FPS'], [60, '60 FPS']]} />
                <Select id="interval" label="Screenshot interval" value={c.captureIntervalSec} disabled={c.capture !== 'screenshots'} onChange={(v) => setDraft({ captureIntervalSec: v })} options={[[1, '1 s'], [2, '2 s'], [5, '5 s'], [10, '10 s']]} hint="Requested; actual times are recorded." />
              </div>

              <div className="grid cols-2">
                <fieldset className="seg">
                  <legend><Ruler size={18} aria-hidden /> Metrics to capture</legend>
                  {SELECTABLE_METRICS.map((m: MetricId) => {
                    const a = d.metrics[m];
                    const ok = a === 'supported';
                    return (
                      <label key={m} className="check">
                        <input type="checkbox" disabled={!ok} checked={ok && c.metrics.includes(m)} onChange={(e) => setDraft({ metrics: e.target.checked ? [...c.metrics, m] : c.metrics.filter((x) => x !== m) })} />
                        {METRICS[m].label}
                        <span className="unit">{ok ? METRICS[m].unit : <AvailabilityBadge a={a} />}</span>
                      </label>
                    );
                  })}
                  <p className="hint">Memory is the game process PSS. Temperature is the battery sensor, not CPU temperature. CPU is system-wide.</p>
                </fieldset>
                <fieldset className="seg">
                  <legend><BatteryMedium size={18} aria-hidden /> Battery</legend>
                  <p className="hint" style={{ marginBottom: 8 }}>
                    In live mode the level and charging state are read from the device. These are demo fixture values for the simulator.
                  </p>
                  <div className="grid cols-2">
                    <Select id="bat" label="Fixture start level" value={c.fixtureBattery?.startLevel ?? 80} onChange={(v) => setDraft({ fixtureBattery: { startLevel: v, charging: c.fixtureBattery?.charging ?? false } })} options={[[100, '100%'], [80, '80%'], [64, '64%'], [40, '40%']]} />
                    <label className="check" style={{ alignSelf: 'end' }}>
                      <input type="checkbox" checked={c.fixtureBattery?.charging ?? false} onChange={(e) => setDraft({ fixtureBattery: { startLevel: c.fixtureBattery?.startLevel ?? 80, charging: e.target.checked } })} />
                      Fixture: charging
                    </label>
                  </div>
                  <p className="hint" style={{ marginTop: 8 }}>
                    <Info size={13} aria-hidden /> Tracks battery level. Current, voltage and charge counter only where the device supports them: {(['current', 'voltage', 'chargeCounter'] as MetricId[]).map((m) => `${METRICS[m].label.replace('Battery ', '')} ${d.metrics[m]}`).join(', ')}.
                  </p>
                </fieldset>
              </div>

              <div className="grid cols-2">
                <div className="field">
                  <label htmlFor="notes">Notes</label>
                  <textarea id="notes" className="input" value={c.notes} maxLength={500} onChange={(e) => setDraft({ notes: e.target.value })} />
                </div>
                <div className="field">
                  <label htmlFor="tags">Tags</label>
                  <input id="tags" className="input" value={c.tags.join(', ')} onChange={(e) => setDraft({ tags: e.target.value.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 8) })} placeholder="e.g. hotfix, greenhouse" />
                  <span className="hint">Comma separated.</span>
                </div>
              </div>
            </div>
          </Card>
          <div className="callout">
            <Info size={18} aria-hidden />
            <span>
              <strong>Fictional device profile:</strong> {d.name} · {d.os} · {d.cpu} · GPU: {d.gpu} · RAM {d.ramGb} GB · Display {d.display}
            </span>
          </div>
        </div>

        <div className="stack">
          <Card title="Readiness" id="readiness-title">
            <p className="hint" style={{ marginBottom: 6 }}>Simulated checks against the device profile. They do not verify real hardware.</p>
            <div>
              {checks.map((ch) => (
                <div key={ch.id} className="ready-item">
                  {STATUS_ICON[ch.status]}
                  <div>
                    <strong>{ch.label}</strong>
                    <div className="subtle">{ch.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
          {c.capture !== 'off' && <Callout tone="warn"><strong>Capture adds overhead.</strong> Impact varies by device and capture settings. Compare runs with matching capture settings.</Callout>}
          {problems.length > 0 && (
            <Callout tone="bad">
              <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
            </Callout>
          )}
          <button className="btn primary big" onClick={start} disabled={problems.length > 0 || starting || !!s.live}>
            <Play size={20} aria-hidden /> {s.live ? 'A session is recording' : starting ? 'Starting…' : 'Start demo session'}
          </button>
          <p className="hint">Starts the simulator, not a device. Data is generated in this browser and labelled simulated everywhere.</p>
          <Card title="Metric colours">
            <div className="legend" style={{ flexDirection: 'column', gap: 6 }}>
              {(['fps', 'frameTime', 'memory', 'temperature', 'battery'] as const).map((m) => (
                <span key={m}><span className="swatch" style={{ background: CHART_COLOR[m], width: 22 }} aria-hidden /> {METRICS[m].label} ({METRICS[m].unit})</span>
              ))}
            </div>
          </Card>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Card title="Recent sessions" actions={<Link to="/results">All results</Link>} className="flush">
          <div className="table-wrap">
            <table>
              <thead><tr><th>Session</th><th>State</th><th>Created</th></tr></thead>
              <tbody>
                {recent.map((x) => (
                  <tr key={x.id}>
                    <td><Link to={x.state === 'recording' ? '/live' : `/results/${x.id}`}>{x.name}</Link></td>
                    <td><StateBadge state={x.state} /></td>
                    <td className="subtle">{fmtDate(x.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

function Select({ id, label, value, options, onChange, disabled, hint }: { id: string; label: string; value: number; options: [number, string][]; onChange: (v: number) => void; disabled?: boolean; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="input" value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}
