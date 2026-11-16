import { Plug } from 'lucide-react';
import { DEVICES, METRICS } from '../domain/catalog';
import type { MetricId } from '../domain/types';
import { AvailabilityBadge, Callout, Card } from '../components/ui';

export function DevicesPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Devices</h1>
          <div className="meta">Fictional device profiles. Each one declares which connections, capture modes and metrics are possible.</div>
        </div>
      </div>
      <div className="stack">
        <Callout tone="info" icon={<Plug size={18} aria-hidden />}>
          <strong>Companion collector: not connected.</strong> Real devices need a local companion process using authorised platform tools (Android first, over USB). This public demo uses the built-in simulator only and never calls a device.
        </Callout>
        {DEVICES.map((d) => (
          <Card key={d.id} title={d.name} actions={d.collector === 'simulated' ? <span className="badge info">Simulated collector</span> : <span className="badge outline">Not implemented</span>}>
            <div className="grid cols-2">
              <dl className="kv">
                <dt>Platform</dt><dd>{d.os}</dd>
                <dt>CPU</dt><dd>{d.cpu}</dd>
                <dt>GPU</dt><dd>{d.gpu}</dd>
                <dt>Memory</dt><dd>{d.ramGb} GB</dd>
                <dt>Display</dt><dd>{d.display}</dd>
                <dt>Connections</dt><dd>{d.connections.map((c) => (c === 'usb' ? 'USB' : 'Wireless')).join(', ')}</dd>
                <dt>Capture over USB</dt><dd>{d.captures.usb.join(', ') || 'none'}</dd>
                <dt>Capture over wireless</dt><dd>{d.captures.wireless.join(', ') || 'not available'}</dd>
                <dt>Scripted play</dt><dd>{d.botSupported ? 'Supported (demo scripts)' : 'Not supported'}</dd>
              </dl>
              <div className="table-wrap">
                <table>
                  <caption className="sr-only">Metric availability for {d.name}</caption>
                  <thead><tr><th>Metric</th><th>Availability</th></tr></thead>
                  <tbody>
                    {(Object.keys(METRICS) as MetricId[]).map((m) => (
                      <tr key={m}><td>{METRICS[m].label} <span className="subtle">({METRICS[m].scope})</span></td><td><AvailabilityBadge a={d.metrics[m]} /></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <p className="hint" style={{ marginTop: 10 }}>{d.wirelessNote}</p>
          </Card>
        ))}
      </div>
    </>
  );
}
