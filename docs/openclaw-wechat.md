# Third-Party AI API Analysis & OpenClaw WeChat Integration

Token Monitor supports **Third-Party AI API Analysis** and **bidirectional OpenClaw → WeChat integration** across standalone Node Hub and Desktop **`local`**, **`host`**, and **`client`** modes:

1. **Third-Party AI API Report Analysis**: Connect an OpenAI-compatible API (OpenAI, DeepSeek, SiliconFlow, New API / OneAPI, OpenRouter, Zhipu, local Ollama/vLLM) or Anthropic Messages API to automatically or manually generate structured analysis summaries combining periodic usage reports, live device telemetry, and **third-party API / subscription quota balances**.
2. **Event-Driven Active Push to WeChat**: Push WeChat-friendly bullet digests to an **OpenClaw Gateway Webhook** (`/hooks/agent` with `channel: "openclaw-weixin"`, `/hooks/wake`, or a generic webhook) on:
   - **Period Rollover (`report`)**: Daily/weekly/monthly usage digests (via `events.rollover` / `pushOnRollover`)
   - **Session Turn Completed (`session_completed`)**: Settled turn delta, cumulative session tokens/cost, cache hit rate, context remaining, and optional detail/AI summary
   - **Approval Alerts (`approval_alert`)**: Read-only Codex / Antigravity tool approval notifications
   - **Quota Alerts (`quota_alert`)**: Low-quota warnings below `thresholdPercent` and recovery notifications
   - **Service Incidents (`service_incident`)**: Upstream AI vendor outage/degraded/recovery notifications
   - **Query Digests, Connectivity Tests & Custom Messages (`query_digest`, `test`, `custom`)**: On-demand pushes from Settings, quick-push buttons, CLI, or MCP
3. **Conversational Q&A from WeChat (Skill & MCP)**: OpenClaw queries live usage, active/completed sessions, history trends, device/collector health, provider & third-party balances + quota history, subscriptions & exhaustion forecasts, live `tok/s` rates, upstream service status, and pending approvals via **Streamable HTTP MCP (`POST /api/mcp`)**, **`--local` stdio MCP**, or the bundled **OpenClaw Skill** (`skills/openclaw-token-monitor/`).

---

## 1. Configuring Third-Party AI API Analysis

### Desktop UI (`local`, `host`, or connected `client` mode)

Open **Settings → Multi-device Sync → Project usage reports → Third-party AI report analysis**:

1. Enable **Third-party AI report analysis**.
2. Choose **API protocol**:
   - `OpenAI Compatible` (works with DeepSeek, OpenAI, SiliconFlow, New API / OneAPI, OpenRouter, Ollama `/v1`, etc.)
   - `Anthropic Messages` (works with Anthropic Claude API and Anthropic-compatible relays)
3. Enter **Base URL** (for example `https://api.deepseek.com/v1` or `https://api.anthropic.com`), **Model** (e.g. `deepseek-chat`, `gpt-4o-mini`, `claude-sonnet-4-5`), and **API key**.
   - Keys are stored server-side only (Desktop writes them to `userData/credentials.json` via `CredentialStore`; standalone Node Hub writes them to `<reportsDir>/integrations.secrets.json` with `0o600` permissions). Raw keys are never returned over HTTP, IPC, or to the renderer/Android client.
4. Optionally enable **Auto-analyze rolled-over periods** so rolled-over daily/weekly/monthly archives are automatically summarized by AI (default `maxTokens: 4096`, automatically retrying once if a reasoning model exhausts tokens on thinking before emitting output).
5. Click **Save**, then click **Analyze latest** to preview immediately.

### Environment variables (Standalone Node Hub)

```env
TOKEN_MONITOR_AI_ENABLED=1
TOKEN_MONITOR_AI_PROTOCOL=openai-compatible
TOKEN_MONITOR_AI_PROVIDER=DeepSeek
TOKEN_MONITOR_AI_BASE_URL=https://api.deepseek.com/v1
TOKEN_MONITOR_AI_MODEL=deepseek-chat
TOKEN_MONITOR_AI_API_KEY=sk-...
TOKEN_MONITOR_AI_LANGUAGE=zh-CN
TOKEN_MONITOR_AI_AUTO_ANALYZE=1
```

---

## 2. One-Click QR Code Setup ("Scan QR to Add to WeChat")

In Desktop **Local**, **Host**, or connected **Client** mode, open **Settings → Multi-device Sync → OpenClaw WeChat delivery** and click **Scan QR to Add to WeChat** (`扫码添加到微信`):

1. Token Monitor starts a WeChat ClawBot / `@tencent-weixin/openclaw-weixin` iLink QR session (`POST /ilink/bot/get_bot_qrcode?bot_type=3`) and renders the QR code inline as a crisp SVG.
2. Scan the QR code with mobile WeChat and confirm binding (entering any phone pairing verification code inline if prompted).
3. Upon confirmation, Token Monitor automatically:
   - Saves the WeChat bot credentials to `~/.openclaw/openclaw-weixin/accounts.json` and `accounts/<accountId>.json` (`0o600`, pruning stale duplicates for the same user) and stores the bot token in `CredentialStore` / Hub secrets.
   - Configures `~/.openclaw/openclaw.json` (`plugins.entries["openclaw-weixin"].enabled = true`, `hooks.enabled = true`, `hooks.path = "/hooks"`, `hooks.token`, `hooks.allowedAgentIds`, and `channels["openclaw-weixin"].channelConfigUpdatedAt`).
   - Installs `skills/openclaw-token-monitor/SKILL.md` and `skills/openclaw-token-monitor/scripts/query-token-monitor.mjs` into `~/.openclaw/skills/openclaw-token-monitor/`.
   - Fills Token Monitor's OpenClaw settings (`enabled: true`, `mode: "openclaw-agent"`, `webhookUrl: "http://127.0.0.1:18789/hooks/agent"` or your configured Gateway port, `channel: "openclaw-weixin"`, `to: "<ilink_user_id>"`, and `hookToken`).
4. **First-message activation (`context_token`)**: Tencent's iLink `sendmessage` API requires an active `context_token` captured from an inbound message. While OpenClaw Gateway is running, send one message (for example `"你好"`) to the newly added **微信 ClawBot** inside WeChat, then click **Test OpenClaw Push** (`发送测试消息`) or **Push to WeChat** (`立即推送到微信`).
5. **If OpenClaw is not installed yet**: Your scanned WeChat binding is still saved under `~/.openclaw/openclaw-weixin/`. Install OpenClaw and the plugin (`npm install -g openclaw && npx -y @tencent-weixin/openclaw-weixin-cli install`), then run `openclaw gateway restart` — no second QR scan is needed.

---

## 3. Desktop `local` Mode, Event Config & Webhook Envelopes

### Using OpenClaw in Desktop `local` Mode (No Multi-Device Hub Required)

Token Monitor no longer restricts OpenClaw to `host` / `client` sync modes:

- **Active Push (`local` mode)**: Desktop main process tracks live session completion (`sessionCompletion.js`), approval alerts, quota thresholds, and upstream service status directly in-process and posts to your OpenClaw Gateway using the `openclawHookToken` stored in `CredentialStore`.
- **Local Loopback Bridge (`openclaw.localBridge`)**: When you want OpenClaw on the same machine to **query** Token Monitor in `local` mode without enabling LAN device sync, enable **Local Loopback Bridge** in OpenClaw settings:
  - Binds strictly to `127.0.0.1:<port>` (default port `17322`).
  - Uses an independent Bearer token generated and stored in `CredentialStore` (never exposed directly in renderer state; copy or rotate it from Settings via **Copy Token** / **Copy MCP Config** / **Regenerate Token**).
  - Exposes the exact same `/api/health`, `/api/query/*`, `/api/reports*`, `/api/integrations/openclaw/*`, `/api/approval-alerts` (`GET`), and `/api/mcp` surface as Node Hub.

### Extended `openclaw` Configuration Fields

Alongside legacy top-level fields (`enabled`, `mode`, `webhookUrl`, `channel`, `to`, `agentId`, `senderName`, `deliver`, `pushOnRollover`, `pushGranularities`, `includeAiAnalysis`, `includeLimits`), `openclaw` configuration supports these nested blocks (deep-merged via `mergeOpenClawIntegrationConfig`):

| Field | Default | Description |
| --- | --- | --- |
| `events.rollover` | `false` | Push daily/weekly/monthly rollover digests (bidirectionally synced with `pushOnRollover`). |
| `events.sessionCompleted` | `false` | Push when an active agent session turn settles (`active -> ended`). |
| `events.approvalAlerts` | `false` | Forward Codex / Antigravity tool approval alerts to OpenClaw. |
| `events.quotaAlerts` | `false` | Push when provider/third-party quota drops below threshold or recovers. |
| `events.serviceIncidents` | `false` | Push when upstream AI service status degrades or recovers. |
| `sessionCompletion.clients` | `[]` | Client filter list (empty array = all supported clients). |
| `sessionCompletion.excludeSubagents` | `true` | Skip subagent sessions (`parentSessionId` present). |
| `sessionCompletion.excludeBackgroundReview` | `true` | Skip background review sessions (`sessionKind === 'background-review'`). |
| `sessionCompletion.minTurnTokens` | `0` | Minimum per-turn delta tokens required before pushing. |
| `sessionCompletion.minTotalTokens` | `0` | Minimum cumulative session tokens required before pushing. |
| `sessionCompletion.debounceMs` | `2500` | Settle delay before emitting, allowing tokscale counters/cost to finalize. |
| `sessionCompletion.cooldownMs` | `0` | Optional minimum cooldown between notifications for the same session. |
| `sessionCompletion.includeDetailSummary` | `false` | Privacy gate: include recent turn prompt/tool summary when local transcript is available. |
| `sessionCompletion.includeAiSummary` | `false` | Include a short third-party AI summary of the completed turn when configured. |
| `quotaAlerts.thresholdPercent` | `20` | Remaining percentage threshold (`1..99`) triggering low-quota alerts. |
| `quotaAlerts.notifyRecovery` | `true` | Also send a notification when quota recovers above threshold / full. |
| `queryPermissions.allowSessionDetail` | `false` | Privacy gate: allow MCP / HTTP `/api/query/session-detail` reads (`403` when false). |
| `queryPermissions.allowConversationText` | `false` | Privacy gate: allow `includeConversation=true` full message reads (`403` when false). |
| `localBridge.enabled` | `false` | Enable the `127.0.0.1` loopback query/MCP bridge in Desktop `local` mode. |
| `localBridge.port` | `17322` | Loopback bridge TCP port (`1..65535`). |

### Manual Gateway Setup & Webhook Event Envelopes

Ensure your OpenClaw Gateway has the WeChat channel plugin (for example `@tencent-weixin/openclaw-weixin`) connected and Inbound Webhooks enabled:

```json5
// In ~/.openclaw/openclaw.json
{
  "gateway": {
    "port": 18789
  },
  "hooks": {
    "enabled": true,
    "token": "<YOUR_OPENCLAW_HOOK_TOKEN>",
    "path": "/hooks",
    "allowedAgentIds": ["main"]
  }
}
```

Or configure standalone Node Hub via environment variables:

```env
TOKEN_MONITOR_OPENCLAW_ENABLED=1
TOKEN_MONITOR_OPENCLAW_MODE=openclaw-agent
TOKEN_MONITOR_OPENCLAW_WEBHOOK_URL=http://127.0.0.1:18789/hooks/agent
TOKEN_MONITOR_OPENCLAW_TOKEN=<YOUR_OPENCLAW_HOOK_TOKEN>
TOKEN_MONITOR_OPENCLAW_CHANNEL=openclaw-weixin
TOKEN_MONITOR_OPENCLAW_TO=<WECHAT_OPENID_OR_TARGET_ID>
TOKEN_MONITOR_OPENCLAW_AGENT_ID=main
TOKEN_MONITOR_OPENCLAW_PUSH_ON_ROLLOVER=1
```

Delivery modes and payloads:

- **`openclaw-agent`**: Sends `POST /hooks/agent` with `Authorization: Bearer <hookToken>`, `Idempotency-Key`, and `{ message, name: "Token Monitor", agentId, deliver: true, channel, to }`, prepending an event-appropriate instruction prefix for `report`, `session_completed`, `approval_alert`, `quota_alert`, `service_incident`, `query_digest`, `test`, or `custom`.
- **`openclaw-wake`**: Sends `POST /hooks/wake` with `{ text, mode: "now" }`.
- **`generic-webhook`**:
  - Legacy `report` (when `eventType === "report"` and no `eventPayload` override is passed): sends `{ event: "token_monitor.report", reportId, granularity, periodKey, channel, to, text, report, aiAnalysis, limitsSummary }`.
  - Event & query envelopes (`session_completed`, `approval_alert`, `quota_alert`, `service_incident`, `query_digest`, `test`, `custom`): sends `{ event: "token_monitor.<eventType>", eventType, eventId, channel, to, text, payload }`.

All deliveries record into a bounded ring buffer (`pushHistory`, max 50 entries in `integrations-state.json`, exposed via `GET /api/integrations/openclaw/history`), and successful deliveries with an `idempotencyKey` are deduplicated across a sliding window (failed attempts remain retryable).

---

## 4. Privacy Gates & Data Safety

- **Session Title Stripping (`sessionTitlesEnabled`)**: When `sessionTitlesEnabled` is `false` (or sync title policy is disabled on the Hub), session completion notifications, `list_sessions`, `GET /api/query/sessions`, and `GET /api/query/session-detail` strip all title text fields (`title: null`) and fall back to `projectLabel` / `sessionId`.
- **Session Detail & Conversation Gates**: `queryPermissions.allowSessionDetail` and `queryPermissions.allowConversationText` default to `false`. Calling `GET /api/query/session-detail` or MCP `get_session_detail` while disabled returns HTTP `403` (`session_detail_disabled` / `conversation_text_disabled`).
- **Zero Secret & Email Leakage**: `openclawHookToken`, `aiApiKey`, `weixinBotToken`, `localBridge` token, `accountEmail`, and local filesystem paths are never included in HTTP responses, MCP tool results, WeChat digests, or webhook payloads.

---

## 5. Setting Up WeChat → OpenClaw Q&A (Skill & MCP)

### Option A: OpenClaw Skill (`skills/openclaw-token-monitor`)

Install (automatically synced by **Scan QR to Add to WeChat** / **Provision** or copied manually) `skills/openclaw-token-monitor/` into `~/.openclaw/skills/openclaw-token-monitor/` and set:

```env
TOKEN_MONITOR_HUB_URL=http://127.0.0.1:17321   # or http://127.0.0.1:17322 for Desktop Local Bridge
TOKEN_MONITOR_HUB_SECRET=<YOUR_HUB_OR_BRIDGE_SECRET>   # legacy TOKEN_MONITOR_SECRET is also supported
```

Key CLI commands (pass `--format text` for WeChat-friendly bullet replies without wide Markdown tables, or omit / pass `--format json` for structured JSON):

```bash
node scripts/query-token-monitor.mjs usage --period today --group-by model --format text
node scripts/query-token-monitor.mjs sessions --state running --format text
node scripts/query-token-monitor.mjs session-detail --client codex --session-id <id> --format text
node scripts/query-token-monitor.mjs history --resolution daily --from 2026-11-01 --format text
node scripts/query-token-monitor.mjs devices --format text
node scripts/query-token-monitor.mjs limits --third-party-only --format text
node scripts/query-token-monitor.mjs subscriptions --format text
node scripts/query-token-monitor.mjs live-rate --format text
node scripts/query-token-monitor.mjs service-status --format text
node scripts/query-token-monitor.mjs approvals --format text
node scripts/query-token-monitor.mjs brief --granularity daily --period latest --format text
node scripts/query-token-monitor.mjs push --test
node scripts/query-token-monitor.mjs push --type usage --period today --group-by project
node scripts/query-token-monitor.mjs push-history --format text
```

### Option B: Connect OpenClaw as an MCP Client

Point OpenClaw's MCP configuration to your Main Hub or Desktop Local Loopback Bridge:

- **URL**: `http://127.0.0.1:17321/api/mcp` (or `http://127.0.0.1:17322/api/mcp` for Desktop `local` mode bridge)
- **Header**: `Authorization: Bearer <TOKEN_MONITOR_HUB_SECRET>`
- **Offline fallback**: `node src/mcp/server.js --local` (reads `devices.json` and `reports/` directly from disk for reports and core usage/session/history/device/limits/subscription/rate queries)

OpenClaw can then call all **17 MCP tools** (`list_usage_reports`, `get_usage_report`, `generate_usage_report`, `analyze_project_usage`, `get_realtime_usage_and_limits`, `analyze_report_with_ai`, `push_report_to_openclaw`, `query_usage_breakdown`, `list_sessions`, `get_session_detail`, `get_usage_history`, `get_devices_and_health`, `get_limits_history`, `get_subscriptions_and_forecasts`, `get_live_token_rate`, `get_service_status_and_approvals`, `push_to_openclaw`), read **9 static resources** (including `usage://today`, `sessions://active`, `limits://current`, `devices://health`, `subscriptions://summary`, `service-status://current`), or invoke prompts such as `wechat-digest`, `session-summary`, `quota-check`, and `daily-standup-usage`. See [the reports and MCP guide](reports-mcp.md).
