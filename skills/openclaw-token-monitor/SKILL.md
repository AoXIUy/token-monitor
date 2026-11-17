---
name: token-monitor-reports
description: Query Token Monitor real-time token usage, active/completed sessions, model/tool/project breakdowns, usage history, device health, third-party API balances & quota history, subscriptions & burn forecasts, live tok/s rate, AI service status, pending approvals, and periodic reports, and deliver concise digests to WeChat via OpenClaw.
---

# Token Monitor Telemetry, Queries & Reports Skill

Use this skill whenever the user (via WeChat or another OpenClaw channel) asks about AI token consumption, spending, active or recent coding sessions, model/tool/project breakdowns, historical trends, device/collector health, Codex/Claude/OpenRouter/New API/Sub2API/third-party quota balances, subscription renewals/exhaustion forecasts, real-time tok/s output speed, upstream AI service outages, pending tool approvals, or daily/weekly/monthly reports.

## Connection Options

You can query Token Monitor using **either** MCP or the bundled zero-dependency CLI helper script (`scripts/query-token-monitor.mjs`).

Both work identically against:
- **Main Hub (Host Mode or Standalone Node Hub)**: default `http://127.0.0.1:17321`
- **Desktop Local Loopback Bridge (`local` mode)**: when the user enables **Local Loopback Bridge** in Token Monitor Desktop (`127.0.0.1:<port>`, default port `17322`), point `TOKEN_MONITOR_HUB_URL` to `http://127.0.0.1:17322` (passing `http://127.0.0.1:17322/api/mcp` is also accepted and normalized by the CLI) and set `TOKEN_MONITOR_HUB_SECRET` (or `TOKEN_MONITOR_SECRET`) to the bridge's Bearer token.

### Option A: MCP Server (Recommended)

Connect OpenClaw to the Streamable HTTP MCP endpoint:
- **URL**: `<TOKEN_MONITOR_HUB_URL>/api/mcp` (default `http://127.0.0.1:17321/api/mcp`, or `http://127.0.0.1:17322/api/mcp` for Desktop `local` mode bridge)
- **Header**: `Authorization: Bearer <TOKEN_MONITOR_HUB_SECRET>` (or `<TOKEN_MONITOR_SECRET>`)
- **Offline fallback (`--local` stdio)**: `node src/mcp/server.js --local` reads `devices.json`, `daily-snapshots.json`, `reports/`, and local `integrations.json` privacy flags directly from disk for reports, core queries (`query_usage_breakdown`, `list_sessions`, `get_usage_history`, `get_devices_and_health`, `get_limits_history`, `get_subscriptions_and_forecasts`, `get_live_token_rate`), and local transcript `get_session_detail`.

Available MCP tools (**17 total**):
- **Reports & AI (7)**:
  - `list_usage_reports` — List persisted daily/weekly/monthly reports
  - `get_usage_report` — Fetch structured JSON or Markdown report (`granularity`, `periodKey`)
  - `generate_usage_report` — Generate/refresh reports from current state
  - `analyze_project_usage` — Rank projects by token share, cost, and tool/model mix
  - `get_realtime_usage_and_limits` — Live today/month/all-time tokens, cost, devices, and sanitized provider/third-party quotas
  - `analyze_report_with_ai` — Ask the configured third-party AI API to analyze a report or answer a custom `question`
  - `push_report_to_openclaw` — Legacy report-specific OpenClaw webhook push
- **Unified Live & Historical Queries (9)**:
  - `query_usage_breakdown` — Usage & cost breakdown by `period` (`today|month|week|last7|last30|allTime`) and `groupBy` (`summary|model|client|project|device`)
  - `list_sessions` — List/filter/sort sessions (`running|waiting|ended|idle|all`, by `client`, `project`, `deviceId`, `search`, paginated via `cursor`)
  - `get_session_detail` — Single-session turn/tool breakdown and optional conversation text (privacy-gated!)
  - `get_usage_history` — Daily/monthly/summary history, streaks, peak day, and client/model trends
  - `get_devices_and_health` — Connected devices, OS, freshness, `clientHealth` diagnostics, and WSL status
  - `get_limits_history` — Current provider/third-party balances, reset countdowns, and optional quota history series
  - `get_subscriptions_and_forecasts` — Active plans, monthly USD total, renewal countdown, and top-up burn/exhaustion forecast
  - `get_live_token_rate` — Real-time output rate (`tok/s`), burn rate (`$/h`), or period throughput fallback
  - `get_service_status_and_approvals` — Upstream AI vendor status, Codex reset forecast, and pending Desktop approvals
- **Unified Push (1)**:
  - `push_to_openclaw` — Format & push `report`, `usage`, `sessions`, `session_detail`, `history`, `devices`, `limits`, `subscriptions`, `live_rate`, `service_status`, `test`, or `custom` messages to OpenClaw

Available MCP resources (**9 static + 1 template**) & prompts (**8**):
- Static resources: `report://latest/daily`, `report://latest/weekly`, `report://latest/monthly`, `usage://today`, `sessions://active`, `limits://current`, `devices://health`, `subscriptions://summary`, `service-status://current`
- Resource template: `report://{granularity}/{periodKey}` (append `?format=markdown` for Markdown)
- Prompts: `analyze-daily-report`, `analyze-weekly-report`, `analyze-monthly-report`, `project-deep-dive`, `wechat-digest`, `session-summary`, `quota-check`, `daily-standup-usage`

---

### Option B: CLI Helper Script (Zero Dependencies)

Environment variables:
- `TOKEN_MONITOR_HUB_URL` — Main Hub or Local Bridge base URL (default `http://127.0.0.1:17321`; also accepts `--hub-url <url>`)
- `TOKEN_MONITOR_HUB_SECRET` (or legacy `TOKEN_MONITOR_SECRET`, or `--secret <token>`) — Bearer token when auth is enabled

Run from this skill folder (`--format text` is strongly recommended for WeChat; omit `--format` or pass `--format json` for raw structured JSON):

#### When to use each command

1. **Today / week / month / model / tool / project / device usage**:
   ```bash
   node scripts/query-token-monitor.mjs usage --period today --group-by model --format text
   node scripts/query-token-monitor.mjs usage --period last7 --group-by project --format text
   node scripts/query-token-monitor.mjs today --format text
   node scripts/query-token-monitor.mjs month --group-by client --format text
   ```
   - `--period`: `today | month | week | last7 | last30 | allTime`
   - `--group-by`: `summary | model | client | project | device`
   - Optional filters: `--device <deviceId>`, `--limit <n>`

2. **Active, waiting, or recent sessions ("What is running right now? Which session spent the most?")**:
   ```bash
   node scripts/query-token-monitor.mjs sessions --state running --format text
   node scripts/query-token-monitor.mjs sessions --period today --sort totalTokens --limit 10 --format text
   node scripts/query-token-monitor.mjs sessions --client codex --project token-monitor --format text
   ```
   - `--period`: `today | month | allTime`
   - `--state`: `running | waiting | ended | idle | all`
   - `--sort`: `lastUsedAt | totalTokens | costUsd`
   - Optional filters: `--client <name>`, `--project <label|key>`, `--device <id>`, `--search <text>`, `--limit <n>`, `--cursor <token>`

3. **Single session turn breakdown or conversation text (Privacy-Gated)**:
   ```bash
   node scripts/query-token-monitor.mjs session-detail --client codex --session-id rollout-123 --format text
   node scripts/query-token-monitor.mjs session-detail --client claude --session-id sess-456 --include-conversation --limit 20 --format text
   ```
   - Optional: `--device <id>`, `--limit <n>`, `--offset <n>`
   - **Privacy gates**: `session-detail` requires Desktop Host or Local Bridge with `openclaw.queryPermissions.allowSessionDetail = true`. Passing `--include-conversation` additionally requires `openclaw.queryPermissions.allowConversationText = true`. If disabled, the Hub returns `403` and the CLI prints which switch to enable — **do not retry repeatedly or work around it**; report the exact privacy instruction to the user.

4. **Historical trends, streaks, and peak days**:
   ```bash
   node scripts/query-token-monitor.mjs history --resolution daily --from 2026-11-01 --to 2026-11-17 --format text
   node scripts/query-token-monitor.mjs history --resolution monthly --group-by client --format text
   ```
   - `--resolution`: `daily | monthly | summary`
   - `--group-by`: `none | client | model`

5. **Device online status & collector health diagnostics**:
   ```bash
   node scripts/query-token-monitor.mjs devices --format text
   node scripts/query-token-monitor.mjs devices --device macbook-pro --no-diagnostics --format json
   ```

6. **Provider quotas, third-party API balances, reset countdowns & quota history**:
   ```bash
   node scripts/query-token-monitor.mjs limits --format text
   node scripts/query-token-monitor.mjs limits --third-party-only --format text
   node scripts/query-token-monitor.mjs limits --provider codex --history --hours 24 --format text
   ```
   - Filters: `--third-party-only`, `--provider <id>`, `--status <status>`, `--history`, `--account-key <key>`, `--window-name <name>`, `--hours <n>`

7. **Subscriptions, renewal dates & top-up exhaustion forecasts**:
   ```bash
   node scripts/query-token-monitor.mjs subscriptions --format text
   node scripts/query-token-monitor.mjs subscriptions --no-forecasts --format json
   ```

8. **Live output speed (`tok/s`) & burn rate (`$/h`)**:
   ```bash
   node scripts/query-token-monitor.mjs live-rate --format text
   ```

9. **Upstream AI service status, Codex reset forecast & pending tool approvals**:
   ```bash
   node scripts/query-token-monitor.mjs service-status --format text
   node scripts/query-token-monitor.mjs approvals --format text
   ```

10. **Periodic WeChat brief, full archived reports & third-party AI analysis**:
    ```bash
    node scripts/query-token-monitor.mjs brief --granularity daily --period latest --format text
    node scripts/query-token-monitor.mjs realtime --third-party-only
    node scripts/query-token-monitor.mjs reports --granularity weekly --limit 5
    node scripts/query-token-monitor.mjs report --granularity weekly --period latest
    node scripts/query-token-monitor.mjs ai-analyze --granularity daily --question "本周哪个项目缓存命中率最低，如何优化？"
    ```

11. **Trigger OpenClaw WeChat push or inspect recent delivery history**:
    ```bash
    node scripts/query-token-monitor.mjs push --test
    node scripts/query-token-monitor.mjs push --type usage --period today --group-by model
    node scripts/query-token-monitor.mjs push --type limits --third-party-only
    node scripts/query-token-monitor.mjs push --type custom --message "提醒：New API 余额偏低"
    node scripts/query-token-monitor.mjs push --granularity daily --period latest
    node scripts/query-token-monitor.mjs push-history --format text
    ```

---

## Privacy & WeChat Reply Rules

1. **Always prefer `--format text` inside WeChat (`openclaw-weixin`)**: `--format text` formats output as concise bullet points and numbered items without wide Markdown tables (which wrap or break in WeChat chat bubbles).
2. **Respect session title privacy (`sessionTitlesEnabled`)**: When `sessionTitlesEnabled === false`, `title` is `null` in query results. Fall back to `projectLabel` and `sessionId`; never invent, infer, or ask for hidden titles.
3. **Respect detail/conversation privacy gates (`403`)**: If `session-detail` fails with `403` (`session_detail_disabled` or `conversation_text_disabled`), clearly tell the user which toggle to enable in **Token Monitor → Settings → Multi-device Sync → OpenClaw Integration**.
4. **Never expose secrets or raw emails**: Never echo `TOKEN_MONITOR_HUB_SECRET`, `openclawHookToken`, `aiApiKey`, `weixinBotToken`, or account email addresses in WeChat replies.
5. **Keep WeChat replies scannable**: Include exact period bounds (`startDate ~ endDate`), total tokens, known USD cost, cache hit rate, top 3–5 items, and any tight/erroring quotas or warnings prominently under ~1,800 Chinese characters unless the user asks for full raw output.
