# Third-Party AI API Analysis & OpenClaw WeChat Integration

Token Monitor Main Hub (standalone Node Hub or Desktop Host Mode) supports:

1. **Third-Party AI API Report Analysis**: Connect an OpenAI-compatible API (OpenAI, DeepSeek, SiliconFlow, New API / OneAPI, OpenRouter, Zhipu, local Ollama/vLLM) or Anthropic Messages API to automatically or manually generate structured analysis summaries combining periodic usage reports, live device telemetry, and **third-party API / subscription quota balances**.
2. **Bidirectional OpenClaw → WeChat Integration**:
   - **Active push to WeChat**: Main Hub pushes formatted digests (daily/weekly/monthly report metrics, top projects, third-party API balances, and AI analysis) to an **OpenClaw Gateway Webhook** (`/hooks/agent` with `channel: "openclaw-weixin"`, `/hooks/wake`, or a generic webhook) automatically on period rollover or on demand.
   - **Conversational Q&A from WeChat**: OpenClaw connects back to Token Monitor via either **Streamable HTTP MCP (`POST /api/mcp`)** or the bundled **OpenClaw Skill** (`skills/openclaw-token-monitor/`) so you can ask questions about your usage, projects, and third-party API balances directly inside WeChat.

---

## 1. Configuring Third-Party AI API Analysis

### Desktop Host / Connected Client UI

Open **Settings → Multi-device Sync → Project usage reports → Third-party AI report analysis**:

1. Enable **Third-party AI report analysis**.
2. Choose **API protocol**:
   - `OpenAI Compatible` (works with DeepSeek, OpenAI, SiliconFlow, New API / OneAPI, OpenRouter, Ollama `/v1`, etc.)
   - `Anthropic Messages` (works with Anthropic Claude API and Anthropic-compatible relays)
3. Enter **Base URL** (for example `https://api.deepseek.com/v1` or `https://api.anthropic.com`), **Model** (e.g. `deepseek-chat`, `gpt-4o-mini`, `claude-sonnet-4-5`), and **API key**.
   - Keys are stored server-side only (Desktop Host writes them to `userData/credentials.json`; standalone Node Hub writes them to `<reportsDir>/integrations.secrets.json` with `0o600` permissions). Raw keys are never returned over HTTP or to the renderer/Android client.
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

In Desktop **Host** mode (or connected **Client** mode), open **Settings → Multi-device Sync → Project usage reports → OpenClaw WeChat delivery** and click **Scan QR to Add to WeChat** (`扫码添加到微信`):

1. Token Monitor starts a WeChat ClawBot / `@tencent-weixin/openclaw-weixin` iLink QR session (`POST /ilink/bot/get_bot_qrcode?bot_type=3`) and renders the QR code inline as a crisp SVG.
2. Scan the QR code with mobile WeChat and confirm binding (entering any phone pairing verification code inline if prompted).
3. Upon confirmation, Token Monitor automatically:
   - Saves the WeChat bot credentials to `~/.openclaw/openclaw-weixin/accounts.json` and `accounts/<accountId>.json` (`0o600`, pruning stale duplicates for the same user) and stores the bot token in the Main Hub / CredentialStore.
   - Configures `~/.openclaw/openclaw.json` (`plugins.entries["openclaw-weixin"].enabled = true`, `hooks.enabled = true`, `hooks.path = "/hooks"`, `hooks.token`, `hooks.allowedAgentIds`, and `channels["openclaw-weixin"].channelConfigUpdatedAt`).
   - Copies `skills/openclaw-token-monitor/` into `~/.openclaw/skills/openclaw-token-monitor/`.
   - Fills Token Monitor's OpenClaw settings (`enabled: true`, `mode: "openclaw-agent"`, `webhookUrl: "http://127.0.0.1:18789/hooks/agent"` or your configured Gateway port, `channel: "openclaw-weixin"`, `to: "<ilink_user_id>"`, and `hookToken`).
4. **First-message activation (`context_token`)**: Tencent's iLink `sendmessage` API requires an active `context_token` captured from an inbound message. While OpenClaw Gateway is running, send one message (for example `"你好"`) to the newly added **微信 ClawBot** inside WeChat, then click **Push to WeChat** (`立即推送到微信`).
5. **If OpenClaw is not installed yet**: Your scanned WeChat binding is still saved under `~/.openclaw/openclaw-weixin/`. Install OpenClaw and the plugin (`npm install -g openclaw && npx -y @tencent-weixin/openclaw-weixin-cli install`), then run `openclaw gateway restart` — no second QR scan is needed.

---

## 3. Manual OpenClaw + WeChat Active Push

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

Then in Token Monitor (**Settings → Project usage reports → OpenClaw WeChat delivery**) or via Hub environment variables:

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

- **`openclaw-agent`** mode sends `POST /hooks/agent` with `Authorization: Bearer <hookToken>`, `Idempotency-Key`, `{ message, name: "Token Monitor", agentId, deliver: true, channel, to }`.
- **`openclaw-wake`** mode sends `POST /hooks/wake` with `{ text, mode: "now" }`.
- **`generic-webhook`** mode sends a structured JSON payload `{ event: "token_monitor.report", text, report, aiAnalysis, limitsSummary }` for custom WeChat/Enterprise WeChat/bot middleware.

---

## 4. Setting Up WeChat → OpenClaw Q&A (Skill & MCP)

### Option A: OpenClaw Skill (`skills/openclaw-token-monitor`)

Copy `skills/openclaw-token-monitor/` into your OpenClaw skills directory (e.g. `~/.openclaw/skills/openclaw-token-monitor/`) and export `TOKEN_MONITOR_HUB_URL` + `TOKEN_MONITOR_SECRET` in OpenClaw's environment. The bundled script queries `/api/integrations/openclaw/brief`, `/api/reports/ai-analyze`, `/api/reports/push`, and MCP tools directly with zero external dependencies.

### Option B: Connect OpenClaw as an MCP Client

Point OpenClaw's MCP configuration to your Main Hub:

- **URL**: `http://<hub-host>:17321/api/mcp`
- **Header**: `Authorization: Bearer <TOKEN_MONITOR_SECRET>`

OpenClaw can then call `get_realtime_usage_and_limits`, `get_usage_report`, `analyze_project_usage`, `analyze_report_with_ai`, `push_report_to_openclaw`, or invoke the `wechat-digest` prompt whenever you ask about usage in WeChat.
