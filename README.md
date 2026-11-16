# Performance Lab

**Game performance sessions you can trust and reproduce.** Performance Lab is a QA tool for mobile game performance: set up a session with explicit test conditions, watch telemetry while you play (or while a scripted bot plays), then get a report where every chart is linked to what was on screen at that moment.

**[Live demo](https://heloisatorres1.github.io/performance-lab/)** · [![CI and Pages](https://github.com/heloisatorres1/performance-lab/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/heloisatorres1/performance-lab/actions/workflows/deploy-pages.yml)

> Portfolio demo. All data is simulated by a deterministic, seeded generator (fictional game *Orbit Garden*, fictional devices). No device, bot or Notion account is connected, and nothing leaves your browser.

## Why build it

The goal is a performance tool that a QA team **owns and can shape to its own needs**, instead of paying for a commercial product such as GameBench and working within its limits.

Every team and project measures something slightly different. One game cares about load times, another about thermal throttling in long sessions, another about battery drain on low-end phones. Here those needs are code and configuration the team controls:

- **Rules per project**: frame-rate targets, frame-time limits, memory budgets and comparison thresholds are versioned settings, not fixed vendor defaults.
- **Device profiles**: the team declares which devices it tests and what each one can measure.
- **Scenarios and bot scripts**: repeatable test routes are written for each game.
- **Metrics and collectors**: new metrics plug in through one collector interface, with their source, unit and scope declared.
- **Where results go**: Notion is one publishing destination; others (Confluence, Slack, a team dashboard) use the same publisher interface.
- **Reports and exports**: the definitions, the HTML report and the CSV/JSON bundle are open, so results can feed any other tool.

There is no per-seat licence, and no test data has to leave the team's own machines.

## The problem

Performance testing on mobile games tends to go wrong in the same ways:

- Runs are compared even though one was on USB with video capture and the other was wireless with no capture.
- "Average FPS" and "p95 frame time" are computed differently every time, sometimes from screenshots or from the reciprocal of an average.
- A frame-time spike shows up in a graph, and nobody can tell what the game was doing at that moment.
- Battery results say "8% drain" when the data shows 8 percentage points, and a phone that was quietly charging is reported as efficient.
- A run interrupted by a disconnect is glued onto the next one, or passes because the missing data looked like zero.

## What it does

| Area | What you can do |
| --- | --- |
| **Sessions** | Choose build, device, scenario, connection (USB / wireless), play mode (manual / scripted bot) and capture (off / screenshots / video) as independent options. The device profile decides which combinations exist. Readiness checks run before you start. |
| **Live Monitor** | Simulated recording with metric cards, charts that end at "now", the latest screenshot labelled with its age (never "live"), markers, bot progress, sample gaps and capture cadence. Stop & save, cancel, or simulate a disconnect. |
| **Results** | Session list grouped by device, build or scenario, with filters for play mode, completeness and verdict. |
| **Report** | Verdict with the exact failing rule, stat cards with their definitions, linked charts (one cursor for all of them), matching evidence screenshot with signed offset, markers, battery analysis, rules, diagnostics, metric sources and export. |
| **Compare** | Baseline vs candidate. Conditions are checked first; mismatches block the verdict until you acknowledge them. Signed deltas with units and threshold rules. |
| **Publishing** | Notion preview with property mapping, explicit "Simulate publish", per-step delivery status, retry and a delivery log. |
| **Devices / Settings** | Fictional device profiles with a capability matrix; versioned threshold rules; measurement definitions; demo reset. |

## Measurement rules

These are implemented in `src/domain/` and covered by unit tests:

- **Average FPS** = valid presented frames ÷ valid observed seconds in the analysis window. Gaps are excluded from both.
- **Frame time percentiles** use nearest-rank on raw frame intervals. They are never derived from average FPS.
- **Time below target** = share of valid 1 s windows below a configured threshold (54 FPS by default for a 60 FPS target). Windows without data are excluded, not counted as zero.
- **Warm-up** (60 s by default) is excluded from frame and telemetry summaries. Battery uses the full session, and the report labels both windows.
- **Battery**: 80% → 72% is **8 percentage points**; over 20 minutes that is **24 pp/hour**, an observed short-interval rate, not a battery-life prediction. Any charging interval invalidates discharge analysis. Power = volts × amps from synchronised samples; energy is integrated without crossing gaps. Unsupported current means "unavailable", never zero.
- **Memory** is the game process PSS in MB (1 GB = 1024 MB). **Temperature** is the battery sensor, not CPU temperature. **CPU** is system-wide.
- **Evidence alignment**: the capture closest to the selected time within ±1.5 s, shown with its signed offset (e.g. 12:33.6, offset −0.4 s). Outside that, "No nearby capture". A screenshot sequence is never called a video.
- **Charts** decimate for display (min/max per pixel so spikes survive). Report numbers always come from raw data.
- **Verdicts**: Within thresholds, Review needed, Incomplete, Not evaluated. Interrupted, cancelled and bot-failed runs never pass. "Review needed" is a QA signal, not a release approval.

## Run it

```bash
npm install
npm run dev           # http://localhost:5173
npm test              # unit tests (Vitest)
npx playwright install chromium
npx playwright test   # end-to-end journeys
npm run build         # static build in dist/
```

Try these:

1. **Results → Garden loop · 0.8.4**: the report opens on the scene-transition marker. Use the arrow keys on a chart and watch every chart and the screenshot follow.
2. **Compare**: 0.8.3 vs 0.8.4 shows "Review needed". Switch the candidate to the USB run and the verdict is blocked until you acknowledge the different conditions.
3. **Sessions → Start demo session**, set the speed to 60×, add a marker, then **Simulate disconnect**. The report is Incomplete, and **Start a continuation** creates a new session that keeps the gap.
4. **Publishing**: tick *Next page times out (but is created)*, publish, then **Check & retry**. The page is found, not created twice.

Your changes are kept in this browser's local storage. **Settings → Reset demo** restores the fixtures.

## QA strategy

- **Unit tests** (Vitest) cover the brief's acceptance checks: battery 8 pp / 24 pp/hour, charging invalidation, unsupported power, percentile method, warm-up and gap exclusion, below-target windows, decimation not changing results, prefix-stable simulation, alignment and tolerance, verdict states, comparison deltas and blocking, device-profile combinations, lifecycle transitions, CSV formula neutralisation, HTML escaping, export bundle round trip, and publication retry without duplicates.
- **End-to-end tests** (Playwright) cover setup → record → report, linked cursor and evidence by keyboard, capture gaps, disconnect and continuation, reload during recording, compare mismatch, failed publish → retry, export download, ruleset versioning and the narrow layout. Every journey fails if a request leaves localhost.
- **Accessibility**: labelled controls, charts exposed as keyboard sliders with value text, a data table alternative to the charts, visible focus, focus-trapped dialogs, and status always shown with text and icon, never colour alone. Chart colours were validated for contrast and colour-vision separation on the dark panel.

## Architecture

React + TypeScript (Vite), no backend.

```
src/domain/        pure logic: simulation, analysis, alignment, verdicts, comparison, export, lifecycle
src/integrations/  collector and publisher interfaces, mock Notion, publication pipeline
src/data/          app state, fixtures, actions, publish snapshots (persisted to localStorage)
src/components/    charts, evidence viewer, layout, shared UI
src/routes/        screens
```

A live version needs pieces this demo deliberately does not have:

- **A local companion collector** (desktop process) that owns device access through authorised platform tools and talks to the UI over an authenticated localhost API. Android over USB is the first planned spike. Every metric must be verified per device and OS before it is shown as supported; iOS stays "Not implemented" until a verified toolchain exists. The `CompanionCollector` interface in `src/integrations/types.ts` describes the boundary.
- **A server** that holds the Notion integration token, uploads assets and pages, and retries with the same idempotent steps used by the mock.

## Known limitations

- All telemetry, screenshots and bot activity are simulated. No hardware validation has been done.
- Single user, data kept in one browser.
- The Notion destination is an in-browser stand-in; no API request is made.
- Video capture is simulated as a timeline of stills; there is no real video file.
- PDF export is not implemented; the bundle includes a standalone HTML report.
