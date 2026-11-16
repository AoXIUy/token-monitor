# Usage & Project Analysis Reports and MCP

Token Monitor's Main Hub can generate, persist, and serve standardized **daily, weekly, and monthly** usage & project analysis reports (`token-monitor-report/v1`) in both JSON and Markdown, and expose them to coding agents over the **Model Context Protocol (MCP)**.

This feature is a **Node Hub / Desktop Host extension**. The Cloudflare Worker does not implement the `/api/reports*` or `/api/mcp` routes.

---

## Overview & architecture

Synchronized `DeviceRecord` uploads intentionally omit unbounded `allTime.sessions` and can omit `today.projects` / `month.projects` under payload limits, while retained `history.daily` stores per-tool and per-model totals without per-project breakdowns. To preserve accurate **weekly** and **monthly** project attribution across all connected devices, the Main Hub maintains a dedicated report store:

```text
<reportsDir>/
├── config.json              # Persisted { enabled, daily, weekly, monthly } settings
├── daily-snapshots.json     # Rolling daily usage + project rollups (up to 400 days)
├── daily/
│   ├── YYYY-MM-DD.json
│   └── YYYY-MM-DD.md
├── weekly/
│   ├── YYYY-Www.json        # ISO-8601 week (Monday..Sunday)
│   └── YYYY-Www.md
└── monthly/
    ├── YYYY-MM.json
    └── YYYY-MM.md
```

- **Daily snapshots (`daily-snapshots.json`)**: When devices upload to the Hub, the report manager captures the current day's project rollups, client/model totals, token components, and throughput into `daily-snapshots.json`.
- **Automatic rollover archiving**: When a new day, ISO week, or calendar month begins, the Hub finalizes and archives the previous period's report automatically when report generation is enabled.
- **Deduplicated atomic writes**: Each report is written atomically using temporary files and rename. Before writing, the Hub compares `reportContentSignature(report)` (a deterministic 128-bit hash of the report excluding `period.generatedAt`) against the existing `.json` file so unchanged reports are not rewritten unless `force: true` is passed.
- **Dual MCP access**: AI clients can connect directly to the Main Hub's HTTP endpoint (`POST /api/mcp`), or run the zero-dependency stdio MCP server (`src/mcp/server.js`) against either a remote Hub or local on-disk files.

---

## Enabling reports

### Standalone Node Hub

Configure automatic report generation via CLI flags or environment variables (see [Configuration](configuration.md) for general Hub precedence):

| CLI flag | Environment variable | Values / default |
| --- | --- | --- |
| `--reports` | `TOKEN_MONITOR_REPORTS` | Off by default. Accepts `1`, `true`, `all`, or a comma-separated list such as `daily,weekly` (`none` or `0` disables). |
| `--reports-dir` / `--reportsDir` | `TOKEN_MONITOR_REPORTS_DIR` | Output directory. Defaults to `<dirname(dataFile)>/reports` (typically `data/reports`). |

Examples:

```bash
# Enable daily, weekly, and monthly reports
TOKEN_MONITOR_SECRET=your-secret npm run hub -- --reports

# Enable only daily and weekly reports into a custom directory
npm run hub -- --secret=your-secret --reports=daily,weekly --reports-dir=/var/lib/token-monitor/reports
```

In `.env`:

```env
TOKEN_MONITOR_REPORTS=1
TOKEN_MONITOR_REPORTS_DIR=./data/reports
```

You can also inspect or toggle the schedule at runtime via `GET /api/reports/config` and `PUT /api/reports/config` (see [API.md](API.md#usage-and-project-analysis-reports-and-mcp-node-hub-extension)).

### Desktop Host Mode (Settings UI)

In the desktop app, open **Settings → Multi-device Sync → Project usage reports**:

1. Set the sync mode to **Host hub on this device** (or **Connect to a hub** to trigger manual generation on a remote Main Hub).
2. Enable **Project usage reports (Main Hub)** (`reportsEnabled`).
3. Choose which granularities to generate automatically: **Daily**, **Weekly**, and **Monthly**.
4. Optionally click **Choose folder…** to pick a custom output folder (defaults to `<userData>/reports`), or **Open folder** to inspect generated `.json` and `.md` files.
5. Click **Generate now** to build and write reports immediately. In Host Mode, the status line also shows the local HTTP MCP endpoint (`http://127.0.0.1:<port>/api/mcp`).

The desktop app reads `TOKEN_MONITOR_REPORTS_ENABLED`, `TOKEN_MONITOR_REPORTS_DAILY`, `TOKEN_MONITOR_REPORTS_WEEKLY`, `TOKEN_MONITOR_REPORTS_MONTHLY`, and `TOKEN_MONITOR_REPORTS_DIR` as first-run defaults; once changed in the UI, saved settings take precedence.

---

## Standard report template specification (`token-monitor-report/v1`)

Both `buildUsageReport` and `renderReportMarkdown` are implemented in [`src/shared/usageReport.js`](../src/shared/usageReport.js).

### Period keys

- **Daily (`daily`)**: `YYYY-MM-DD` (for example `2026-11-16`), or aliases `latest` / `current`.
- **Weekly (`weekly`)**: ISO-8601 week `YYYY-Www` spanning Monday through Sunday (for example `2026-W47`), or aliases `latest` / `current`. Week 1 is the week containing January 4 (the first Thursday of the ISO year).
- **Monthly (`monthly`)**: `YYYY-MM` (for example `2026-11`), or aliases `latest` / `current`.

### JSON schema (`token-monitor-report/v1`)

| Top-level field | Type / key fields | Description |
| --- | --- | --- |
| `schemaVersion` | `1` | Numeric report schema version. |
| `schema` | `"token-monitor-report/v1"` | Report schema identifier. |
| `reportId` | `string` | Canonical identifier `"<granularity>:<period.key>"` (e.g. `weekly:2026-W47`). |
| `granularity` | `"daily" \| "weekly" \| "monthly"` | Report period granularity. |
| `period` | `{ granularity, key, label, startDate, endDate, timeZone, isCurrent, previousPeriodKey, generatedAt }` | Resolved calendar bounds, timezone, whether the period is still active, previous period key, and ISO UTC generation timestamp. |
| `hub` | `{ runtime, deviceCount, activeDeviceCount, staleDeviceCount }` | Hub runtime identifier and device freshness counts. |
| `coverage` | `{ tokenComponentsComplete, projectsComplete, projectAttributionSource, historyComplete }` | Provenance and completeness flags for components, project attribution, and trend history. |
| `summary` | `{ totalTokens, knownCostUsd, unpricedTokens, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, unclassifiedTokens, cacheHitRatePct, messageCount, sessionCount, projectCount, activeDays, activeTimeMs, peakDay, throughput, comparison }` | Aggregate totals, component breakdown, `peakDay` (`{ date, tokens, costUsd } \| null`), duration-weighted `throughput` (`{ timedTokens, timedOutputTokens, timedDurationMs, avgOutputTokensPerSec }`), and `comparison` against `previousPeriodKey` (`{ previousPeriodKey, previousTokens, previousCostUsd, tokenDelta, tokenDeltaPct, costDelta, costDeltaPct } \| null`). |
| `projects` | `Array` sorted by `tokens` desc | `{ key, label, tokens, costUsd, unpricedTokens, tokenSharePct, costSharePct, sessionCount, clients: [{ client, tokens, sharePct }], models: [{ model, tokens, sharePct }] }` |
| `clients` | `Array` sorted by `tokens` desc | `{ client, tokens, costUsd, unpricedTokens, tokenSharePct, costSharePct, cacheReadTokens, cacheWriteTokens, outputTokens, inputTokens, unclassifiedTokens, cacheHitRatePct, messageCount }` |
| `models` | `Array` sorted by `tokens` desc | `{ model, tokens, costUsd, unpricedTokens, tokenSharePct, costSharePct, cacheReadTokens, cacheWriteTokens, outputTokens, inputTokens, unclassifiedTokens, cacheHitRatePct, avgOutputTokensPerSec }` |
| `devices` | `Array` sorted by `tokens` desc | `{ deviceId, hostname, platform, stale, tokens, costUsd, tokenSharePct, projectCount }` |
| `timeline` | `Array` covering `startDate..endDate` | Per-day rows `[{ date, tokens, costUsd, activeTimeMs, topClient, topModel }]`. |
| `signals` | `Array` | Objective rule-based signals `[{ code, severity, summary, ...details }]` (`info` or `warning`). |

#### `coverage.projectAttributionSource` semantics

| Value | Meaning |
| --- | --- |
| `live-period` | Project totals came directly from the Hub's live `stats.periods.today` (current daily) or complete `stats.periods.month` (current monthly). |
| `daily-snapshots` | Project totals were read from or merged across `daily-snapshots.json` covering all active days in the period. |
| `session-window` | No `daily-snapshots.json` entries existed for the weekly range, so project attribution fell back to rolling up deduplicated sessions in `stats.periods.month.sessions` / device records whose `lastUsedAt` fell inside `[startDate, endDate]`. `coverage.projectsComplete` is `false`. |
| `partial` | Some active days in a weekly or monthly period had `daily-snapshots.json` entries while other active days were missing snapshots. `coverage.projectsComplete` is `false`. |
| `none` | No project attribution data was available for the period (`coverage.projectsComplete` is `false` whenever `totalTokens > 0`). |

#### Automated signal codes

- `top-project-concentration`: Top project accounts for `>= 50%` (`info`) or `>= 80%` (`warning`) of period tokens.
- `low-cache-hit-rate`: `cacheHitRatePct < 30%` (`info`) or `< 10%` (`warning`) across `>= 10,000` measured input tokens.
- `period-usage-spike` / `period-usage-drop`: Period tokens increased by `>= 50%` (`info`) / `>= 100%` (`warning`), or decreased by `>= 50%` (`info`) compared to `previousPeriodKey`.
- `unpriced-tokens-present`: Usage includes tokens without catalog pricing (`warning` when `>= 50%` of total tokens).
- `stale-devices-present`: One or more connected devices are stale (`warning`).
- `incomplete-project-attribution`: `totalTokens > 0` while `coverage.projectsComplete` is `false` (`info`).

### 5-section Markdown template

Each `.md` report begins with YAML frontmatter followed by five standard sections:

```markdown
---
schema: "token-monitor-report/v1"
reportId: "weekly:2026-W47"
granularity: "weekly"
periodKey: "2026-W47"
startDate: "2026-11-16"
endDate: "2026-11-22"
generatedAt: "2026-11-16T22:00:00.000Z"
totalTokens: 1250000
knownCostUsd: 4.825
projectCount: 3
---

# Token Monitor Usage Report — 2026-W47 (2026-11-16..2026-11-22)

Report ID: `weekly:2026-W47` · Timezone: `Asia/Shanghai` · Devices: 2/2 active

## Executive Summary
...metric table (tokens, cost, components, cache hit rate, throughput, peak day, comparison)...

## Project Usage Analysis
...attribution source & completeness line + ranked project table...

## Tools & Models Efficiency
### Clients
...client breakdown table...
### Models
...model breakdown table with cache hit rate and speed (tok/s)...

## Timeline & Multi-Device Breakdown
### Daily Timeline
...per-day table across startDate..endDate...
### Devices
...per-device contribution and staleness table...

## Automated Signals
...bullet list of triggered signals or a no-signals note...
```

---

## MCP Server integration

The MCP report server is implemented by [`src/shared/mcpReportProtocol.js`](../src/shared/mcpReportProtocol.js) (supporting MCP protocol versions `2025-06-18`, `2025-03-26`, and `2024-11-05`) and exposed through two transports:

1. **Streamable HTTP MCP** built into the Node Hub at `POST /api/mcp` (requires `Authorization: Bearer <secret>` or `X-Token-Monitor-Secret: <secret>` when a Hub secret is configured).
2. **Stdio MCP Server** via `node src/mcp/server.js` (or `npm run mcp`), supporting both **Hub HTTP API mode** (`--hub-url` / `TOKEN_MONITOR_HUB_URL`, `--secret` / `TOKEN_MONITOR_SECRET`) and **Local Store direct mode** (`--data-file` / `TOKEN_MONITOR_DATA_FILE`, `--reports-dir` / `TOKEN_MONITOR_REPORTS_DIR`, or `--local`) for reading Hub JSON files directly from disk without a running HTTP server.

### Exposed Tools

| Tool | Arguments | Description |
| --- | --- | --- |
| `list_usage_reports` | `granularity?` (`daily` \| `weekly` \| `monthly`), `limit?` (integer `>= 1`) | Lists persisted reports and current Hub report config. |
| `get_usage_report` | `granularity` (**required**), `periodKey?` (`latest` \| `current` \| `YYYY-MM-DD` \| `YYYY-Www` \| `YYYY-MM`), `format?` (`json` \| `markdown`, default `json`) | Fetches a report in JSON (with `structuredContent`) or Markdown text. |
| `generate_usage_report` | `granularity?` (`daily` \| `weekly` \| `monthly`), `periodKey?`, `force?` (boolean) | Generates or refreshes reports on the Hub or local store (omitting `granularity` defaults to `'all'`, generating daily, weekly, and monthly). |
| `analyze_project_usage` | `granularity?` (default `weekly`), `periodKey?`, `project?` (name or canonical key filter), `limit?` (integer `>= 1`) | Returns ranked project shares, dominant client/model per project, top-1/top-3 concentration metrics, period comparison, and signals. |

### Exposed Resources

- Static resources (`application/json`):
  - `report://latest/daily`
  - `report://latest/weekly`
  - `report://latest/monthly`
- Resource template:
  - `report://{granularity}/{periodKey}` — reads any `daily`, `weekly`, or `monthly` period as JSON, or append `?format=markdown` (e.g. `report://weekly/2026-W47?format=markdown`) for `text/markdown`.

### Exposed Prompts

| Prompt | Arguments | Purpose |
| --- | --- | --- |
| `analyze-daily-report` | `periodKey?` (`YYYY-MM-DD` or `latest`) | Summarize daily tokens, cost, project concentration, and cache efficiency. |
| `analyze-weekly-report` | `periodKey?` (`YYYY-Www` or `latest`) | Summarize weekly project, tool, model, and multi-device distribution. |
| `analyze-monthly-report` | `periodKey?` (`YYYY-MM` or `latest`) | Review monthly cost trends, model mix, and project share. |
| `project-deep-dive` | `project` (**required**), `granularity?`, `periodKey?` | Deep-dive analysis of one project's token share, cost, client/model mix, and signals. |

---

## Client configuration examples

### Claude Code

Connect over HTTP to a running Main Hub:

```bash
claude mcp add --transport http token-monitor-reports http://127.0.0.1:17321/api/mcp \
  --header "Authorization: Bearer <your-hub-secret>"
```

Or connect via stdio (`src/mcp/server.js`) in `.mcp.json`:

```json
{
  "mcpServers": {
    "token-monitor-reports": {
      "command": "node",
      "args": ["/path/to/token-monitor/src/mcp/server.js"],
      "env": {
        "TOKEN_MONITOR_HUB_URL": "http://127.0.0.1:17321",
        "TOKEN_MONITOR_SECRET": "<your-hub-secret>"
      }
    }
  }
}
```

Or configure HTTP directly in `.mcp.json`:

```json
{
  "mcpServers": {
    "token-monitor-reports": {
      "type": "http",
      "url": "http://127.0.0.1:17321/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-hub-secret>"
      }
    }
  }
}
```

### Cursor (`.cursor/mcp.json`)

HTTP transport against the Main Hub:

```json
{
  "mcpServers": {
    "token-monitor-reports": {
      "url": "http://127.0.0.1:17321/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-hub-secret>"
      }
    }
  }
}
```

Or stdio transport:

```json
{
  "mcpServers": {
    "token-monitor-reports": {
      "command": "node",
      "args": [
        "/path/to/token-monitor/src/mcp/server.js",
        "--hub-url",
        "http://127.0.0.1:17321",
        "--secret",
        "<your-hub-secret>"
      ]
    }
  }
}
```

### Antigravity

In Antigravity's MCP configuration (`~/.gemini/antigravity/mcp_config.json`), configure either the Hub HTTP endpoint or the local stdio server:

```json
{
  "mcpServers": {
    "token-monitor-reports": {
      "serverUrl": "http://127.0.0.1:17321/api/mcp",
      "headers": {
        "Authorization": "Bearer <your-hub-secret>"
      }
    }
  }
}
```

Stdio alternative:

```json
{
  "mcpServers": {
    "token-monitor-reports": {
      "command": "node",
      "args": ["/path/to/token-monitor/src/mcp/server.js"],
      "env": {
        "TOKEN_MONITOR_HUB_URL": "http://127.0.0.1:17321",
        "TOKEN_MONITOR_SECRET": "<your-hub-secret>"
      }
    }
  }
}
```

### Local direct mode (`--data-file` / `--reports-dir`)

When the Hub HTTP server is not running (or when reading a desktop app's `hub-devices.json` and `reports` directory directly from disk), pass `--data-file` and `--reports-dir` to `src/mcp/server.js`:

```json
{
  "mcpServers": {
    "token-monitor-reports-local": {
      "command": "node",
      "args": [
        "/path/to/token-monitor/src/mcp/server.js",
        "--data-file",
        "/path/to/token-monitor/data/devices.json",
        "--reports-dir",
        "/path/to/token-monitor/data/reports"
      ]
    }
  }
}
```

You can also use environment variables `TOKEN_MONITOR_DATA_FILE` and `TOKEN_MONITOR_REPORTS_DIR` (or `--local`).

### Direct HTTP MCP (`POST /api/mcp`)

Any MCP-compatible HTTP client or script can send JSON-RPC 2.0 requests directly to `POST /api/mcp`:

```bash
curl -sS -X POST http://127.0.0.1:17321/api/mcp \
  -H "Authorization: Bearer <your-hub-secret>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "analyze_project_usage",
      "arguments": {
        "granularity": "weekly",
        "periodKey": "latest",
        "limit": 10
      }
    }
  }'
```
