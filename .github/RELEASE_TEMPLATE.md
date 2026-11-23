# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Standalone Antigravity Account Manager Window:** Added an isolated `Antigravity Account Manager` window (`antigravityManager.html` / `src/electron/antigravityManager/`) separated from the main usage/limits collectors and Worker, with encrypted local token storage (`safeStorage` / `0o600`), 7-language support, and entry actions in the tray menu, Limits bar, and Antigravity settings.
- **Quota Query, Multi-Client Switching & Device Profiles:** Added Daily -> Sandbox quota querying (proto3 `0%` handling, `403` verification/model/ban classification, Gemini 4 codename isolation), Classic / IDE (language server hot-switch with restart fallback) / AGY CLI / ACP account switching, isolated device fingerprint profiles, and optional default-off startup & 10-minute interval auto-refresh.
- **Antigravity-Manager Import/Export & Hub Snapshot Sync:** Added JSON (`[{ email, refresh_token }]`) and `~/.antigravity_tools` / `state.vscdb` / local client / legacy V1 / OAuth imports, JSON export, and sanitized Node-Hub-only snapshot routes (`PUT /api/antigravity-manager/snapshot`, `GET /api/antigravity-manager`) for Android read-only viewing.

### Notes
- **OpenClaw & Fork Capabilities:** Preserves all fork capabilities including online Antigravity / Codex conversations for Android, live session output rates, optional approval alerts, daily/weekly/monthly reports & MCP endpoints, and bidirectional OpenClaw integration.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-Setup-0.102.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.102.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.102.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.102.0-x86_64.AppImage` then run it.

### Other notes

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale is bundled with this app and updated through Token Monitor releases. See **Settings → General → Advanced → Tokscale** for the version and fork build identifier. Tokscale is MIT, open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 新增
- **独立 Antigravity 账号管理窗口：** 新增完全独立于主用量/额度采集与 Worker 的 `Antigravity 账号管理` 独立窗口（`antigravityManager.html` / `src/electron/antigravityManager/`），提供系统加密本地凭证存储（`safeStorage` / `0o600`）、7 语言界面，以及托盘菜单、额度页工具栏和 Antigravity 设置页入口。
- **额度查询、多端账号切换与设备指纹：** 支持 Daily -> Sandbox 额度查询（兼容 proto3 `0%` 缺省、`403` 验证/模型/封禁识别与 Gemini 4 代号隔离）、Classic / IDE（优先热切语言服务器，失败回退重启）/ AGY CLI / ACP 账号切换、独立设备指纹绑定，以及默认关闭的启动刷新与 10 分钟定时自动刷新选项。
- **Antigravity-Manager 导入导出与 Hub 快照同步：** 支持导入/导出 Antigravity-Manager 的 JSON（`[{ email, refresh_token }]`）、直接导入 `~/.antigravity_tools` 目录、`state.vscdb`、本机自动扫描、旧版 V1 目录与独立 OAuth 登录，并通过 Node Hub 专属脱敏快照接口（`PUT /api/antigravity-manager/snapshot`、`GET /api/antigravity-manager`）供安卓端只读查看。

### 说明
- **OpenClaw 与分支扩展能力：** 完整保留本分支全部特性，包括安卓端在线 Antigravity / Codex 对话查阅、实时会话输出速率、可选审批提醒、日报/周报/月报与 MCP 接口，以及 OpenClaw 双向集成。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-Setup-0.102.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.102.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.102.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.102.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.101.0...v0.102.0">v0.101.0...v0.102.0</a></summary>

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
- **獨立 Antigravity 帳號管理視窗：** 新增完全獨立於主用量/額度擷取與 Worker 的 `Antigravity 帳號管理` 獨立視窗（`antigravityManager.html` / `src/electron/antigravityManager/`），提供系統加密本機憑證儲存（`safeStorage` / `0o600`）、7 語言介面，以及系統匣選單、額度頁工具列與 Antigravity 設定頁入口。
- **額度查詢、多端帳號切換與裝置指紋：** 支援 Daily -> Sandbox 額度查詢（相容 proto3 `0%` 缺省、`403` 驗證/模型/封禁識別與 Gemini 4 代號隔離）、Classic / IDE（優先熱切換語言伺服器，失敗回退重新啟動）/ AGY CLI / ACP 帳號切換、獨立裝置指紋綁定，以及預設關閉的啟動重新整理與 10 分鐘定時自動重新整理選項。
- **Antigravity-Manager 匯入匯出與 Hub 快照同步：** 支援匯入/匯出 Antigravity-Manager 的 JSON（`[{ email, refresh_token }]`）、直接匯入 `~/.antigravity_tools` 目錄、`state.vscdb`、本機自動掃描、舊版 V1 目錄與獨立 OAuth 登入，並透過 Node Hub 專屬脫敏快照介面（`PUT /api/antigravity-manager/snapshot`、`GET /api/antigravity-manager`）供 Android 唯讀檢視。

### 說明
- **OpenClaw 與分支擴充功能：** 完整保留本分支全部特性，包含 Android 端線上 Antigravity / Codex 對話檢視、即時工作階段輸出速率、可選審批提醒、日報/週報/月報與 MCP 介面，以及 OpenClaw 雙向整合。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-Setup-0.102.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.102.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **독립 Antigravity 계정 관리 창:** 기본 사용량·할당량 수집기와 Worker에서 완전히 분리된 `Antigravity 계정 관리` 창(`antigravityManager.html` / `src/electron/antigravityManager/`)을 추가했으며, 암호화된 로컬 토큰 저장(`safeStorage` / `0o600`), 7개 언어 UI, 트레이·한도·Antigravity 설정 진입점을 제공합니다.
- **할당량 조회, 다중 클라이언트 전환 및 기기 지문:** Daily -> Sandbox 할당량 조회(proto3 `0%` 처리, `403` 인증/모델/차단 분류, Gemini 4 코드명 분리), Classic / IDE(언어 서버 핫스위치 후 재시작 폴백) / AGY CLI / ACP 계정 전환, 독립 기기 지문 바인딩 및 기본값 꺼짐(OFF)인 시작 시/10분 주기 자동 새로고침 옵션을 추가했습니다.
- **Antigravity-Manager 가져오기/내보내기 및 Hub 스냅샷 동기화:** `[{ email, refresh_token }]` JSON, `~/.antigravity_tools` 디렉터리, `state.vscdb`, 로컬 스캔, 구버전 V1, OAuth 가져오기와 JSON 내보내기를 지원하며, Node Hub 전용 정리 스냅샷 라우트(`PUT /api/antigravity-manager/snapshot`, `GET /api/antigravity-manager`)를 통해 Android 읽기 전용 조회를 지원합니다.

### 참고
- **OpenClaw 및 포크 확장 기능:** Android용 온라인 Antigravity / Codex 대화 조회, 실시간 세션 출력 속도, 선택형 승인 알림, 일간/주간/월간 리포트 및 MCP 엔드포인트, 양방향 OpenClaw 통합을 포함한 모든 포크 기능을 유지합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-Setup-0.102.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.102.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **独立した Antigravity アカウント管理ウィンドウ：** メインの使用量・制限コレクターおよび Worker から分離された `Antigravity アカウント管理` ウィンドウ（`antigravityManager.html` / `src/electron/antigravityManager/`）を追加し、暗号化ローカル保存（`safeStorage` / `0o600`）、7言語対応 UI、トレイ・制限・Antigravity 設定の導線を備えました。
- **クォータ照会・マルチクライアント切替・端末プロファイル：** Daily -> Sandbox クォータ照会（proto3 `0%` 処理、`403` 認証/モデル/停止判定、Gemini 4 コードネーム分離）、Classic / IDE（言語サーバーのホット切替＋再起動フォールバック）/ AGY CLI / ACP アカウント切替、独立端末フィンガープリント、および既定 OFF の起動時・10分自動更新オプションを実装しました。
- **Antigravity-Manager インポート/エクスポートおよび Hub スナップショット同期：** `[{ email, refresh_token }]` JSON、`~/.antigravity_tools`、state.vscdb、ローカル検出、V1 フォルダ、OAuth からの取込と JSON 出力に対応し、Node Hub 専用サニタイズ済みエンドポイント（`PUT /api/antigravity-manager/snapshot`、`GET /api/antigravity-manager`）で Android 読み取り専用表示を提供します。

### 注意
- **OpenClaw およびフォーク独自機能：** Android 向けオンライン Antigravity / Codex 会話閲覧、リアルタイムセッション出力レート、任意承認アラート、日次/週次/月次レポートおよび MCP エンドポイント、OpenClaw 双方向連携などの独自機能を引き続きすべて備えています。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-Setup-0.102.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.102.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.102.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.0/Token-Monitor-0.102.0-x86_64.AppImage)

</details>

</details>
