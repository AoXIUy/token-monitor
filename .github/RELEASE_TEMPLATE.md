# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Daily, Weekly & Monthly Usage and Project Reports:** Added a shared `token-monitor-report/v1` engine with calendar-aligned daily (`YYYY-MM-DD`), ISO weekly (`YYYY-Www`), and monthly (`YYYY-MM`) period comparisons, project/tool/model/device breakdowns, automated signals, and standard Markdown + JSON templates.
- **Main Hub Report Generation & APIs:** Added `src/hub/reports.js` and authenticated Node Hub routes (`GET /api/reports`, `GET/PUT /api/reports/config`, `GET /api/reports/:granularity/:periodKey`, `POST /api/reports/generate`) with 400-day daily project snapshots and period-rollover archiving.
- **MCP Report Analysis Integration:** Added zero-dependency MCP JSON-RPC 2.0 support via both Main Hub (`POST /api/mcp`) and standalone stdio server (`npm run mcp`), exposing analysis tools, report resources, and standard analysis prompts.
- **Desktop Report Settings:** Added report toggles, daily/weekly/monthly selection, output directory picker, and manual generation in Desktop settings synced with Host mode.

### Notes
- Includes online conversations, session output rates, read-only approval alerts, and usage/project reports for Android and MCP clients.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-Setup-0.96.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.96.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.96.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.96.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.96.0-x86_64.AppImage` then run it.

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
- **按天 / 按周 / 按月数据使用与项目分析报告：** 新增共享报告引擎（`token-monitor-report/v1`），制定标准 JSON 与 5 章节 Markdown 模板，支持自然日、ISO 自然周和自然月环比对比、项目/工具/模型/设备拆解与关键特征信号提取。
- **主 Hub 统一生成与接口：** 新增 `src/hub/reports.js` 及 Node Hub 鉴权接口（`/api/reports`、`/api/reports/config`、`/api/reports/:granularity/:periodKey`、`/api/reports/generate`），维护 400 天逐日项目快照与跨周期自动归档。
- **MCP 分析报告接入：** 同时支持主 Hub Streamable HTTP（`POST /api/mcp`）与独立 stdio MCP Server（`npm run mcp`），暴露报告查询/生成/项目分析 Tools、Resources 与标准分析 Prompts。
- **桌面端报告设置联动：** 在桌面端设置面板新增总开关、按天/按周/按月选择、输出目录与立即生成入口，并与 Host 模式同步。

### 说明
- 本分支持续提供安卓在线对话、会话输出速率、只读审批提醒与报告/MCP 分析能力。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-Setup-0.96.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.96.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.96.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.96.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.96.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.95.1...v0.96.0">v0.95.1...v0.96.0</a></summary>

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
- **按天 / 按週 / 按月資料使用與專案分析報告：** 新增共享報告引擎（`token-monitor-report/v1`），提供標準 JSON 與 5 章節 Markdown 範本，支援自然日、ISO 自然週與自然月環比對比、專案/工具/模型/裝置拆解與自動特徵訊號。
- **主 Hub 統一生成與介面：** 新增 `src/hub/reports.js` 與 Node Hub 驗證路由（`/api/reports`、`/api/reports/config`、`/api/reports/:granularity/:periodKey`、`/api/reports/generate`），維護 400 天逐日專案快照與跨週期自動封存。
- **MCP 分析報告接入：** 支援主 Hub Streamable HTTP（`POST /api/mcp`）與獨立 stdio MCP Server（`npm run mcp`），提供分析 Tools、Resources 與標準分析 Prompts。
- **桌面端報告設定連動：** 在桌面端設定新增開關、日/週/月週期選擇、輸出目錄與立即生成按鈕，並與 Host 模式同步。

### 說明
- 本分支持續提供 Android 線上對話、工作階段輸出速率、唯讀審批提醒與報告/MCP 分析能力。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-Setup-0.96.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.96.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.96.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **일간 / 주간 / 월간 사용량 및 프로젝트 분석 보고서:** `token-monitor-report/v1` 보고서 엔진을 추가하여 자연일, ISO 주간, 월간 기간 비교 및 프로젝트/도구/모델/장치별 분석과 표준 Markdown + JSON 템플릿을 지원합니다.
- **메인 Hub 보고서 생성 및 API:** `src/hub/reports.js` 및 인증된 Node Hub API(`/api/reports`, `/api/reports/config`, `/api/reports/:granularity/:periodKey`, `/api/reports/generate`)와 400일 일별 프로젝트 스냅샷 아카이빙을 추가했습니다.
- **MCP 보고서 분석 연동:** 메인 Hub Streamable HTTP(`POST /api/mcp`) 및 독립 stdio MCP 서버(`npm run mcp`)를 통해 분석 Tools, Resources, Prompts를 제공합니다.
- **데스크톱 보고서 설정 연동:** 데스크톱 설정에서 보고서 활성화, 일/주/월 주기 선택, 출력 디렉터리 및 즉시 생성 기능을 제공합니다.

### 참고
- 이 포크는 Android용 온라인 대화, 세션 출력 속도, 읽기 전용 승인 알림 및 보고서/MCP 분석 기능을 제공합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-Setup-0.96.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.96.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.96.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **日次・週次・月次の使用量およびプロジェクト分析レポート:** `token-monitor-report/v1` エンジンを追加し、日別・ISO 週別・月別の前期比、プロジェクト／ツール／モデル／デバイス別内訳、自動シグナル、標準 Markdown + JSON テンプレートに対応しました。
- **メイン Hub レポート生成と API:** `src/hub/reports.js` と認証付き Node Hub API（`/api/reports`、`/api/reports/config`、`/api/reports/:granularity/:periodKey`、`/api/reports/generate`）、400日間の日別プロジェクトスナップショットアーカイブを追加しました。
- **MCP レポート分析連携:** メイン Hub Streamable HTTP（`POST /api/mcp`）およびスタンドアロン stdio MCP サーバー（`npm run mcp`）を通じて分析 Tools、Resources、Prompts を公開します。
- **デスクトップ設定連携:** デスクトップ設定にレポート有効化、日次／週次／月次選択、出力フォルダ選択、即時生成ボタンを追加し Host モードと同期します。

### 注意
- このフォークは Android 向けのオンライン会話、セッション出力速度、読み取り専用承認通知、およびレポート／MCP 分析機能を提供します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-Setup-0.96.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.96.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.96.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.96.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.96.0/Token-Monitor-0.96.0-x86_64.AppImage)

</details>

</details>
