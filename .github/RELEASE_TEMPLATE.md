# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **OpenClaw Real-Time Event Pushes:** Automatically push sanitized OpenClaw/WeChat alerts on session turn completion (with settle debounce, subagent/review filtering, and title-privacy toggle), pending Codex/Antigravity approvals, quota low/recovery warnings, AI service incidents, period rollovers, and manual digests.
- **Expanded Data Queries, Hub Routes & MCP Surface:** Added privacy-gated query helpers and Hub endpoints (`/api/query/usage`, `/sessions`, `/history`, `/devices`, `/limits`, `/subscriptions`, `/live-rate`, plus `/api/integrations/openclaw/push` and `/history`), expanding MCP to 17 tools, 9 static resources, 1 template, and 8 prompts with `--local` stdio parity.
- **Desktop Local Mode & Loopback Bridge:** Unlocked OpenClaw configuration, test pushes, and real-time event monitoring directly in Desktop `local` mode, with an optional `127.0.0.1` loopback HTTP/MCP bridge (`CredentialStore`-isolated Bearer token, config copy, and token rotation).
- **Extended OpenClaw Skill & Desktop UI Controls:** Expanded `skills/openclaw-token-monitor/` CLI subcommands (`usage`, `sessions`, `session-detail`, `history`, `devices`, `limits`, `subscriptions`, `live-rate`, `service-status`, `approvals`, `push`, `push-history`) alongside Desktop event toggles, completion filters, push history, and quick-push actions.

### Improved
- **Desktop Context Enrichment & Safeguards:** Enriched `local` and `host` queries with local SQLite quota history, live session output rates, and approval status, backed by idempotency deduplication, in-flight coalescing, email/secret redaction, and prototype-safe query aggregation.

### Notes
- **Core Capabilities:** Continues to provide Android online conversations, session output rates, read-only approval alerts, third-party AI report analysis, OpenClaw WeChat QR login, and multi-device usage/project reports.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-Setup-0.98.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.98.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.98.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.98.0-x86_64.AppImage` then run it.

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
- **OpenClaw 实时事件主动推送：** 支持会话轮次结束自动推送（含消抖稳定等待、子智能体/后台审查过滤与会话标题脱敏开关）、Codex / Antigravity 待处理审批提醒、额度低水位/恢复告警、AI 服务异常通告以及周期归档/手动简报。
- **扩展数据查询层、Hub 接口与 MCP 工具集：** 新增受权限约束的统一查询与 `/api/query/*`、`POST /api/integrations/openclaw/push`、`GET /api/integrations/openclaw/history` 路由，将 MCP 扩展至 17 个工具、9 个静态资源、1 个资源模板与 8 个提示词，并实现 `--local` 本地模式全量对齐。
- **桌面端 `local` 模式与本机回环桥接：** 在单机 `local` 模式下直接开放 OpenClaw 配置保存、测试推送与实时事件监听，并提供可选的 `127.0.0.1` 回环 HTTP/MCP 桥接（Bearer 密钥隔离存储在 `CredentialStore`，支持一键复制接入配置与重置密钥）。
- **OpenClaw Skill CLI 与桌面端控制台：** 扩展 `skills/openclaw-token-monitor/` 查询与推送子命令（`usage`、`sessions`、`session-detail`、`history`、`devices`、`limits`、`subscriptions`、`live-rate`、`service-status`、`approvals`、`push`、`push-history`），并在设置页与主界面/会话详情增加事件矩阵、最近推送记录和快捷推送按钮。

### 改进
- **桌面实时上下文增强与安全加固：** 在 `local` 和 `host` 模式下自动注入本地 SQLite 额度历史、实时会话吞吐与审批状态，配合幂等去重、并发合并、敏感词/邮箱脱敏及防原型污染聚合提升可靠性。

### 说明
- **既有功能保持：** 持续支持安卓在线对话、实时会话输出速率、只读审批提醒、第三方 AI 报告分析、OpenClaw 微信扫码登录以及多设备用量与项目报告。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-Setup-0.98.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.98.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.98.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.98.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.97.2...v0.98.0">v0.97.2...v0.98.0</a></summary>

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
- **OpenClaw 即時事件主動推送：** 支援工作階段輪次結束自動推送（含消抖等待、子代理/背景審查過濾與工作階段標題隱私開關）、Codex / Antigravity 待處理審批提醒、額度低水位/恢復告警、AI 服務異常通知以及週期歸檔/手動簡報。
- **擴展資料查詢層、Hub 介面與 MCP 工具集：** 新增受權限控制的統一查詢與 `/api/query/*`、`POST /api/integrations/openclaw/push`、`GET /api/integrations/openclaw/history` 路由，將 MCP 擴展至 17 個工具、9 個靜態資源、1 個資源範本與 8 個提示詞，並實現 `--local` 本機模式對齊。
- **桌面端 `local` 模式與本機迴環橋接：** 在單機 `local` 模式直接開放 OpenClaw 設定儲存、測試推送與即時事件監聽，並提供可選的 `127.0.0.1` 迴環 HTTP/MCP 橋接（Bearer 金鑰隔離保存於 `CredentialStore`，支援一鍵複製設定與重新產生金鑰）。
- **OpenClaw Skill CLI 與桌面端控制台：** 擴展 `skills/openclaw-token-monitor/` 查詢與推送子命令（`usage`、`sessions`、`session-detail`、`history`、`devices`、`limits`、`subscriptions`、`live-rate`、`service-status`、`approvals`、`push`、`push-history`），並在設定與主畫面/工作階段詳情加入事件矩陣、近期推送紀錄與快捷推送按鈕。

### 改進
- **桌面即時上下文增強與安全防護：** 在 `local` 與 `host` 模式自動注入本機 SQLite 額度歷史、即時工作階段輸出速率與審批狀態，搭配冪等去重、併發合併、敏感資訊/電子郵件遮罩與防原型污染聚合提升穩定性。

### 說明
- **既有功能維持：** 持續提供 Android 線上對話、即時工作階段輸出速率、唯讀審批提醒、第三方 AI 報告分析、OpenClaw 微信掃碼登入以及多裝置用量與專案報告。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-Setup-0.98.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.98.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **OpenClaw 실시간 이벤트 푸시:** 세션 턴 완료 알림(디바운스 대기, 서브에이전트/백그라운드 리뷰 필터링, 세션 제목 보호 토글 포함), Codex / Antigravity 승인 대기 알림, 할당량 부족/복구 경고, AI 서비스 장애 공지, 기간 마감 및 수동 다이제스트 푸시를 지원합니다.
- **확장 데이터 조회 레이어, Hub 라우트 및 MCP 확장:** 권한 제어 기반 `/api/query/*`, `POST /api/integrations/openclaw/push`, `GET /api/integrations/openclaw/history` 엔드포인트를 추가하고 MCP를 도구 17개, 정적 리소스 9개, 템플릿 1개, 프롬프트 8개로 확장했으며 `--local` stdio 모드를 완전 지원합니다.
- **데스크톱 `local` 모드 및 루프백 브리지:** `local` 모드에서 OpenClaw 설정 저장, 테스트 푸시, 실시간 이벤트 감지를 활성화하고 선택형 `127.0.0.1` 루프백 HTTP/MCP 브리지(`CredentialStore` 격리 Bearer 토큰, 설정 복사, 토큰 재발급)를 제공합니다.
- **OpenClaw Skill CLI 및 데스크톱 UI 제어:** `skills/openclaw-token-monitor/` CLI 하위 명령(`usage`, `sessions`, `session-detail`, `history`, `devices`, `limits`, `subscriptions`, `live-rate`, `service-status`, `approvals`, `push`, `push-history`)을 확장하고 설정/메인/세션 상세 화면에 이벤트 매트릭스, 푸시 이력, 빠른 푸시 버튼을 추가했습니다.

### 개선
- **데스크톱 컨텍스트 보강 및 안정화:** `local` 및 `host` 모드 조회에 로컬 SQLite 할당량 이력, 실시간 세션 출력 속도, 승인 상태를 통합하고 멱등성 중복 제거, 동시 요청 병합, 민감 정보/이메일 마스킹 및 프로토타입 안전 집계를 적용했습니다.

### 참고
- **기존 기능 유지:** Android 온라인 대화, 세션 출력 속도, 읽기 전용 승인 알림, 서드파티 AI 보고서 분석, OpenClaw 위챗 QR 로그인 및 다중 기기 사용량/프로젝트 보고서를 계속 제공합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-Setup-0.98.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.98.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **OpenClaw リアルタイムイベント通知:** セッションターン完了通知（デバウンス待機、サブエージェント/バックグラウンドレビュー除外、タイトル保護トグル付き）、Codex / Antigravity 承認待ち通知、クォータ低下/回復アラート、AI サービス障害通知、期間ロールオーバー・手動ダイジェストに対応しました。
- **統合データクエリ層・Hub API・MCP 拡張:** 権限チェック付き `/api/query/*`、`POST /api/integrations/openclaw/push`、`GET /api/integrations/openclaw/history` エンドポイントを追加し、MCP を 17 ツール・9 静的リソース・1 テンプレート・8 プロンプトへ拡張（`--local` stdio モード完全対応）しました。
- **デスクトップ `local` モードとループバックブリッジ:** `local` モード単体で OpenClaw 設定保存・テスト送信・イベント監視を有効化し、任意の `127.0.0.1` ループバック HTTP/MCP ブリッジ（`CredentialStore` 分離 Bearer トークン、設定コピー、トークン再生成）を追加しました。
- **OpenClaw Skill CLI とデスクトップ UI 操作:** `skills/openclaw-token-monitor/` に `usage`、`sessions`、`session-detail`、`history`、`devices`、`limits`、`subscriptions`、`live-rate`、`service-status`、`approvals`、`push`、`push-history` サブコマンドを追加し、設定画面とメイン/セッション詳細画面にイベント設定・送信履歴・クイック送信ボタンを配置しました。

### 改善
- **デスクトップ文脈統合と信頼性向上:** `local` および `host` モードのクエリにローカル SQLite クォータ履歴・リアルタイムセッション速度・承認状況を統合し、冪等性重複排除、並列送信統合、秘匿情報/メールマスク、プロトタイプ汚染対策を実施しました。

### 注意
- **既存機能の継続提供:** Android 向けオンライン会話、セッション出力速度、承認通知、サードパーティ AI レポート分析、OpenClaw WeChat QR ログイン、マルチデバイス使用量/プロジェクトレポートを引き続き提供します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-Setup-0.98.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.98.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.98.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.0/Token-Monitor-0.98.0-x86_64.AppImage)

</details>

</details>
