import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Activity, BarChart3, GitCompareArrows, Menu, Play, Settings, Smartphone, Upload } from 'lucide-react';
import { useAppState } from '../data/state';
import { liveElapsedMs, tickLive } from '../data/actions';
import { fmtClock } from '../domain/analysis';
import { useNow } from './hooks';

const NAV = [
  { to: '/sessions', label: 'Sessions', icon: Play },
  { to: '/live', label: 'Live Monitor', icon: Activity },
  { to: '/results', label: 'Results', icon: BarChart3 },
  { to: '/compare', label: 'Compare', icon: GitCompareArrows },
  { to: '/publishing', label: 'Publishing', icon: Upload },
];

export function Logo() {
  return (
    <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#1b242e" />
      <path d="M5 20h5l3-9 5 14 3-8h6" fill="none" stroke="#22D3EE" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Keeps a recording advancing on every page; opens the report if it ends while you watch it. */
function LiveDriver({ sessionId }: { sessionId: string }) {
  const nav = useNavigate();
  useEffect(() => {
    const h = setInterval(() => {
      const ended = tickLive();
      if (ended && window.location.hash.startsWith('#/live')) nav(`/results/${ended}`);
    }, 250);
    return () => clearInterval(h);
  }, [sessionId, nav]);
  return null;
}

export function Layout() {
  const s = useAppState();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => setNavOpen(false), [loc.pathname]);
  const now = useNow(s.live ? 500 : null);
  const live = s.live ? s.sessions.find((x) => x.id === s.live!.sessionId) : undefined;

  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      {s.live && <LiveDriver sessionId={s.live.sessionId} />}
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Main navigation">
        <NavLink to="/sessions" className="brand">
          <Logo />
          <strong>Performance Lab</strong>
        </NavLink>
        <nav className="nav">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to}>
              <Icon size={19} aria-hidden /> {label}
            </NavLink>
          ))}
        </nav>
        <nav className="nav nav-bottom" aria-label="Workspace">
          <NavLink to="/devices">
            <Smartphone size={19} aria-hidden /> Devices
          </NavLink>
          <NavLink to="/settings">
            <Settings size={19} aria-hidden /> Settings
          </NavLink>
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-btn" aria-label="Open navigation" aria-expanded={navOpen} onClick={() => setNavOpen((v) => !v)}>
            <Menu size={20} />
          </button>
          <label htmlFor="project">Project</label>
          <select id="project" className="input" style={{ width: 'auto' }} defaultValue="og">
            <option value="og">Orbit Garden</option>
          </select>
          <span className="spacer" />
          {live && (
            <NavLink to="/live" className="badge bad" style={{ textDecoration: 'none' }}>
              <span className="rec-dot" aria-hidden /> Recording {fmtClock(liveElapsedMs(s, now))}
            </NavLink>
          )}
          <span className="badge demo" title="Simulated data. No device, bot or Notion account is connected.">
            DEMO
          </span>
        </header>
        <main id="main" className="content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
