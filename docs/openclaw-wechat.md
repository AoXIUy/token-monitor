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
4. Optionally enable **Auto-analyze rolled-over periods** so rolled-over daily/weekly/monthly archives are automatically summarized by AI.
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

## 2. Setting Up OpenClaw + WeChat Active Push

Ensure your OpenClaw Gateway has the WeChat channel plugin (for example `@tencent-weixin/openclaw-weixin`) connected and Inbound Webhooks enabled:

```json5
// In OpenClaw config.json5
{
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
TOKEN_MONITOR_OPENCLAW_WEBHOOK_URL=http://127.0.0.1:19001/hooks/agent
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

## 3. Setting Up WeChat → OpenClaw Q&A (Skill & MCP)

### Option A: OpenClaw Skill (`skills/openclaw-token-monitor`)

Copy `skills/openclaw-token-monitor/` into your OpenClaw skills directory (e.g. `~/.openclaw/skills/openclaw-token-monitor/`) and export `TOKEN_MONITOR_HUB_URL` + `TOKEN_MONITOR_SECRET` in OpenClaw's environment. The bundled script queries `/api/integrations/openclaw/brief`, `/api/reports/ai-analyze`, `/api/reports/push`, and MCP tools directly with zero external dependencies.

### Option B: Connect OpenClaw as an MCP Client

Point OpenClaw's MCP configuration to your Main Hub:

- **URL**: `http://<hub-host>:17321/api/mcp`
- **Header**: `Authorization: Bearer <TOKEN_MONITOR_SECRET>`

OpenClaw can then call `get_realtime_usage_and_limits`, `get_usage_report`, `analyze_project_usage`, `analyze_report_with_ai`, `push_report_to_openclaw`, or invoke the `wechat-digest` prompt whenever you ask about usage in WeChat.
