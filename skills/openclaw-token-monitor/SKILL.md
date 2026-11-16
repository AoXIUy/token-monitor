---
name: token-monitor-reports
description: Query Token Monitor real-time token usage, third-party API balances, daily/weekly/monthly project analysis reports, third-party AI insights, and deliver summaries to WeChat via OpenClaw.
---

# Token Monitor Reports & Telemetry Skill

Use this skill whenever the user (via WeChat or another OpenClaw channel) asks about AI token consumption, API spending, coding project breakdowns, Codex/Claude/OpenRouter/New API/Sub2API/third-party quota balances, or daily/weekly/monthly usage reports.

## Connection Options

You can query Token Monitor using **either** MCP or the bundled helper script:

### Option A: MCP Server (Recommended)
Connect OpenClaw to the running Token Monitor Main Hub Streamable HTTP MCP endpoint:
- URL: `<TOKEN_MONITOR_HUB_URL>/api/mcp` (default `http://127.0.0.1:17321/api/mcp`)
- Header: `Authorization: Bearer <TOKEN_MONITOR_SECRET>`

Available MCP tools:
- `get_realtime_usage_and_limits` — Live today/month/all-time tokens, cost, devices, and third-party API / provider quotas
- `list_usage_reports` — List persisted daily/weekly/monthly reports
- `get_usage_report` — Fetch structured JSON or Markdown report (`granularity: daily|weekly|monthly`, `periodKey: latest|current|YYYY-MM-DD|YYYY-Www|YYYY-MM`)
- `analyze_project_usage` — Rank projects by token share, cost, and tool/model mix
- `analyze_report_with_ai` — Ask the configured third-party AI API to analyze the report or answer a custom `question`
- `push_report_to_openclaw` — Format and push a report digest via OpenClaw Webhook

Prompt shortcut: `wechat-digest`.

### Option B: CLI Helper Script (Zero Dependencies)
Require environment variables:
- `TOKEN_MONITOR_HUB_URL` (e.g. `http://127.0.0.1:17321`)
- `TOKEN_MONITOR_SECRET` (your Hub shared secret, when required)

Run from this skill folder:

```bash
# 1. Ready-to-send WeChat brief (daily / weekly / monthly)
node scripts/query-token-monitor.mjs brief --granularity daily --period latest

# 2. Live telemetry + third-party API / provider balances
node scripts/query-token-monitor.mjs realtime
node scripts/query-token-monitor.mjs realtime --third-party-only

# 3. Full JSON report
node scripts/query-token-monitor.mjs report --granularity weekly --period latest

# 4. Run third-party AI API analysis or ask a question about the data
node scripts/query-token-monitor.mjs ai-analyze --granularity daily --question "本周哪个项目缓存命中率最低，如何优化？"

# 5. Trigger Hub -> OpenClaw WeChat delivery
node scripts/query-token-monitor.mjs push --granularity daily --period latest
```

## WeChat Reply Formatting Rules

When replying directly inside a **WeChat (`openclaw-weixin`)** conversation:
1. Prefer `brief --format text` or summarize JSON numbers using **concise bullet points** instead of wide multi-column Markdown tables (WeChat strips or wraps tables awkwardly).
2. Always include exact periods (`startDate ~ endDate`), total tokens, known USD cost, top 3–5 projects, cache hit rate, and any tight or erroring **third-party API / provider balances**.
3. Surface any `signals` warnings (usage spikes, unpriced tokens, stale devices, low cache hit rate) prominently at the end.
4. Keep replies under ~1,800 Chinese characters unless the user explicitly asks for full raw Markdown.
