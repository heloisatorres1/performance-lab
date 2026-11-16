import { HashRouter, Link, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Card, Empty, ToastProvider } from './components/ui';
import { ComparePage } from './routes/Compare';
import { DevicesPage } from './routes/Devices';
import { LivePage } from './routes/Live';
import { PublishingPage } from './routes/Publishing';
import { ReportPage } from './routes/Report';
import { ResultsPage } from './routes/Results';
import { SessionsPage } from './routes/Sessions';
import { SettingsPage } from './routes/Settings';

// A new key per session resets the selected time when switching reports.
function ReportRoute() {
  const { id } = useParams();
  return <ReportPage key={id} />;
}

export function App() {
  return (
    <HashRouter>
      <ToastProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/results/ses-084" replace />} />
            <Route path="sessions" element={<SessionsPage />} />
            <Route path="live" element={<LivePage />} />
            <Route path="results" element={<ResultsPage />} />
            <Route path="results/:id" element={<ReportRoute />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="publishing" element={<PublishingPage />} />
            <Route path="devices" element={<DevicesPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route
              path="*"
              element={
                <Card>
                  <Empty title="Page not found">
                    <Link to="/sessions">Go to Sessions</Link>
                  </Empty>
                </Card>
              }
            />
          </Route>
        </Routes>
      </ToastProvider>
    </HashRouter>
  );
}
