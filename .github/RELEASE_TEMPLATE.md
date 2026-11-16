# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Third-Party AI API Report & Data Analysis:** Added OpenAI-compatible and Anthropic Messages API support in Main Hub and Desktop Settings (`PUT /api/reports/integrations`, `POST /api/reports/ai-analyze`) to generate cached AI summaries combining periodic usage reports, live device usage, and sanitized third-party API / provider quotas.
- **Bidirectional OpenClaw WeChat Integration:** Added active webhook delivery (`openclaw-agent` `/hooks/agent`, `openclaw-wake` `/hooks/wake`, or generic webhook via `POST /api/reports/push` and automatic rollover) plus conversational WeChat Q&A via the bundled OpenClaw Skill (`skills/openclaw-token-monitor/`) and new MCP tools (`get_realtime_usage_and_limits`, `analyze_report_with_ai`, `push_report_to_openclaw`, `wechat-digest`).
- **Desktop Integration Panel & Secret Isolation:** Added UI configuration and on-demand trigger controls in Desktop Settings while storing API keys and hook tokens exclusively in private Main/Hub storage (`credentials.json` / `0o600` Hub secret store).

### Notes
- Includes online conversations, session output rates, read-only approval alerts, usage/project reports for Android and MCP clients, third-party AI analysis, and OpenClaw WeChat delivery.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-Setup-0.97.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.97.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.97.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.97.0-x86_64.AppImage` then run it.

### Other notes

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale is bundled with this app and updated through Token Monitor releases. See **Settings → Advanced → Tokscale** for the version and fork build identifier. Tokscale is MIT, open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 新增
- **第三方 AI API 报告与数据智能分析：** 在主 Hub 与桌面端设置中支持接入 OpenAI 兼容（DeepSeek、OpenAI、SiliconFlow、New API、OpenRouter、Ollama 等）与 Anthropic Messages API（`PUT /api/reports/integrations`、`POST /api/reports/ai-analyze`），结合周期报告、实时用量与脱敏第三方 API 额度快照生成并缓存 AI 总结。
- **OpenClaw 微信双向接入：** 支持通过 OpenClaw Gateway Webhook（`/hooks/agent` → `openclaw-weixin`、`/hooks/wake` 或通用 Webhook）在周期归档或手动触发时推送报告到微信（`POST /api/reports/push`）；同时提供 OpenClaw Skill（`skills/openclaw-token-monitor/`）与新增 MCP 工具（`get_realtime_usage_and_limits`、`analyze_report_with_ai`、`push_report_to_openclaw`、`wechat-digest`）供微信内对话查询。
- **桌面端集成设置与密钥隔离：** 在桌面端设置面板新增第三方 AI 与 OpenClaw 微信配置及即时触发按钮，密钥仅保存于本机 `credentials.json` 或 Hub 私有文件（`0o600`）。

### 说明
- 本分支持续提供安卓在线对话、会话输出速率、只读审批提醒、周期报告 / MCP 分析，以及第三方 AI 分析与 OpenClaw 微信接入能力。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-Setup-0.97.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.97.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.97.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.97.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.96.0...v0.97.0">v0.96.0...v0.97.0</a></summary>

<!-- github-generated-release-notes -->

</details>

<details>
<summary>繁體中文 · 한국어 · 日本語</summary>

<details>
<summary><strong>繁體中文</strong></summary>

## 繁體中文

## 更新內容

<!-- app-update-notes:zh-TW:start -->
### 新增
- **第三方 AI API 報告與資料智慧分析：** 在主 Hub 與桌面端設定支援 OpenAI 相容（DeepSeek、OpenAI、New API、Ollama 等）與 Anthropic Messages API（`PUT /api/reports/integrations`、`POST /api/reports/ai-analyze`），結合週期報告、即時用量與第三方 API 額度產生並快取 AI 摘要。
- **OpenClaw 微信雙向整合：** 支援透過 OpenClaw Gateway Webhook（`/hooks/agent` → `openclaw-weixin`、`/hooks/wake` 或通用 Webhook）主動推播報告至微信，並隨附 OpenClaw Skill（`skills/openclaw-token-monitor/`）與擴充 MCP 工具供微信對話查詢。
- **桌面端設定與金鑰隔離：** 在桌面端設定新增第三方 AI 與 OpenClaw 微信設定及即時測試按鈕，金鑰僅保存於本機 `credentials.json` 或 Hub 私有檔案（`0o600`）。

### 說明
- 本分支持續提供 Android 線上對話、工作階段輸出速率、唯讀審批提醒、週期報告/MCP 分析，以及第三方 AI 分析與 OpenClaw 微信整合能力。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-Setup-0.97.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.97.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **서드파티 AI API 보고서 및 데이터 분석:** 메인 Hub와 데스크톱 설정에서 OpenAI 호환(DeepSeek, OpenAI, New API, Ollama 등) 및 Anthropic Messages API를 연동하여 사용량 보고서와 실시간 서드파티 API 잔액을 AI로 요약·캐싱합니다.
- **OpenClaw 위챗 양방향 연동:** OpenClaw Gateway Webhook(`/hooks/agent` → `openclaw-weixin`)을 통한 위챗 자동·수동 전송과 번들 OpenClaw Skill(`skills/openclaw-token-monitor/`) 및 확장 MCP 도구(`get_realtime_usage_and_limits`, `analyze_report_with_ai`, `push_report_to_openclaw`) 기반 대화형 조회를 지원합니다.
- **데스크톱 설정 및 자격 증명 격리:** 데스크톱 설정 패널에 AI·OpenClaw 설정 및 즉시 실행 UI를 추가하고 키·토큰은 비공개 저장소(`credentials.json` / `0o600`)에 격리 보관합니다.

### 참고
- 이 포크는 Android용 온라인 대화, 세션 출력 속도, 읽기 전용 승인 알림, 보고서/MCP 분석 및 AI 분석·OpenClaw 위챗 연동을 제공합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-Setup-0.97.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.97.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **サードパーティ AI API レポート＆データ分析:** メイン Hub およびデスクトップ設定で OpenAI 互換（DeepSeek、OpenAI、New API、Ollama など）および Anthropic Messages API を接続し、定期レポート・リアルタイム使用量・外部 API 残高の AI 要約を生成・キャッシュします。
- **OpenClaw WeChat 双方向連携:** OpenClaw Gateway Webhook（`/hooks/agent` → `openclaw-weixin`）による WeChat への自動／手動プッシュ配信に加え、同梱 OpenClaw Skill（`skills/openclaw-token-monitor/`）および拡張 MCP ツールによる WeChat からの対話クエリに対応しました。
- **デスクトップ設定とシークレット分離:** デスクトップ設定に AI・OpenClaw 設定および即時実行ボタンを追加し、API キーとトークンを `credentials.json` / Hub プライベート領域（`0o600`）へ安全に分離保存します。

### 注意
- このフォークは Android 向けのオンライン会話、セッション出力速度、読み取り専用承認通知、レポート／MCP 分析、および AI 分析・OpenClaw WeChat 連携機能を提供します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-Setup-0.97.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.97.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.97.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.0/Token-Monitor-0.97.0-x86_64.AppImage)

</details>

</details>
