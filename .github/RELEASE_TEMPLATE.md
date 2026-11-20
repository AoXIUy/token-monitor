# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Upstream v0.94.0 Sync & Unified Limits Presentation:** Synced [Javis603/token-monitor v0.94.0](https://github.com/Javis603/token-monitor/releases/tag/v0.94.0) (`5888563c`), including unified limit account management, cross-device `limitAccountPresentation` syncing (custom names and per-provider ordering), Alibaba Bailian CLI quota collection with China/International region separation, grouped provider/tool Settings switches, daily trend inspection, and optional exact trend token display.
- **OpenClaw & Reports Account Display:** Updated `src/shared/aiReportAnalyzer.js`, `src/shared/openclawQueries.js`, and `src/electron/openclawBridge.js` so OpenClaw alerts, `/api/query/*`, and reports honor synced `limitAccountPresentation` custom names and Alibaba `accountSelectionKey` (`region`).

### Improved
- **Session Titles, Trend & Settings Performance:** Resolves Codex session titles from custom scan paths, aligns session context meters across widget surfaces, shows `Checking` while accounts await quota readings, avoids double-counting when untracking synced clients, prevents Linux title bar pointer freeze, and reduces main-process work on Hub usage updates.

### Notes
- **OpenClaw & Fork Capabilities:** Includes online Antigravity / Codex conversations for Android, live session output rates, optional approval alerts, real-time session/approval/quota/service-incident pushes, unified `/api/query/*` & 17-tool MCP endpoints, and Desktop `local`-mode loopback bridge.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-Setup-0.99.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.99.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.99.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.99.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.99.0-x86_64.AppImage` then run it.

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
- **同步上游 v0.94.0 与统一额度账户管理：** 合并 [Javis603/token-monitor v0.94.0](https://github.com/Javis603/token-monitor/releases/tag/v0.94.0)（`5888563c`），带来统一额度账户管理、跨设备同步 `limitAccountPresentation`（自定义名称与分服务商排序）、阿里云百炼 CLI 额度采集（区分中国站 / 国际站）、分组工具与额度开关、趋势图按日详情查看以及可选精确 Token 数显示。
- **OpenClaw 与报告账号展示适配：** 更新 `src/shared/aiReportAnalyzer.js`、`src/shared/openclawQueries.js` 与 `src/electron/openclawBridge.js`，使 OpenClaw 通知、`/api/query/*` 查询与分析报告支持同步的 `limitAccountPresentation` 自定义账号名称及阿里云 `accountSelectionKey`（`region`）。

### 改进
- **会话标题、统计一致性与性能：** 支持从自定义扫描路径解析 Codex 会话标题，统一微件各视图的上下文占用条对齐，额度等待采集中显示「Checking」，修复取消跟踪同步客户端时的重复统计、Linux 标题栏右键后指针卡住问题，并降低 Hub 增量推送的主进程开销。

### 说明
- **包含本分支全部扩展能力：** 涵盖安卓端在线对话、实时会话输出速率、可选审批提醒、实时推送、`/api/query/*` 统一查询与 17 工具 MCP 扩展、桌面端 `local` 模式支持及本机 `127.0.0.1` 回环桥接。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-Setup-0.99.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.99.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.99.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.99.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.99.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.98.3...v0.99.0">v0.98.3...v0.99.0</a></summary>

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
- **同步上游 v0.94.0 與統一額度帳戶管理：** 合併 [Javis603/token-monitor v0.94.0](https://github.com/Javis603/token-monitor/releases/tag/v0.94.0)（`5888563c`），帶來統一額度帳戶管理、跨裝置同步 `limitAccountPresentation`（自訂名稱與依服務商排序）、阿里雲百煉 CLI 額度採集（區分中國站 / 國際站）、分組工具與額度開關、趨勢圖每日詳情檢視及可選精確 Token 數顯示。
- **OpenClaw 與報告帳號顯示適配：** 更新 `src/shared/aiReportAnalyzer.js`、`src/shared/openclawQueries.js` 與 `src/electron/openclawBridge.js`，使 OpenClaw 通知、`/api/query/*` 查詢與分析報告支援同步的 `limitAccountPresentation` 自訂帳戶名稱及阿里雲 `accountSelectionKey`（`region`）。

### 改進
- **工作階段標題、統計一致性與效能：** 支援從自訂掃描路徑解析 Codex 工作階段標題，統一微件各檢視的上下文佔用條對齊，額度等待採集中顯示「Checking」，修正取消追蹤同步用戶端時的重複統計、Linux 標題列右鍵後指標卡住問題，並降低 Hub 增量推送的主進程負荷。

### 說明
- **包含本分支全部擴充能力：** 涵蓋 Android 端線上對話、即時工作階段輸出速率、可選審批提醒、即時推送、`/api/query/*` 統一查詢與 17 工具 MCP 擴充，以及桌面端 `local` 模式與本機 `127.0.0.1` 迴環橋接。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-Setup-0.99.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.99.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.99.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **업스트림 v0.94.0 동기화 및 통합 할당량 계정 관리:** [Javis603/token-monitor v0.94.0](https://github.com/Javis603/token-monitor/releases/tag/v0.94.0)(`5888563c`)을 병합해 통합 할당량 계정 관리, 교차 기기 `limitAccountPresentation` 동기화(사용자 지정 이름 및 제공자별 정렬), Alibaba Bailian CLI 할당량 수집(중국/국제 리전 구분), 그룹화된 도구·제공자 설정 스위치, 일별 추세 상세 보기 및 정확한 추세 토큰 수 표시 옵션을 제공합니다.
- **OpenClaw 및 보고서 계정 표시 호환성:** `src/shared/aiReportAnalyzer.js`, `src/shared/openclawQueries.js`, `src/electron/openclawBridge.js`를 업데이트해 OpenClaw 알림, `/api/query/*`, 보고서가 동기화된 `limitAccountPresentation` 이름과 Alibaba `accountSelectionKey`(`region`)를 반영하도록 했습니다.

### 개선
- **세션 제목, 통계 정확도 및 성능:** 사용자 지정 스캔 경로에서 Codex 세션 제목을 해석하고 위젯 화면 간 세션 컨텍스트 미터를 정렬했으며, 할당량 수집 대기 중 `Checking` 상태 표시, 동기화 클라이언트 추적 해제 시 중복 집계 방지, Linux 제목 표시줄 우클릭 후 포인터 멈춤 수정, Hub 업데이트 시 메인 프로세스 부하 감소를 적용했습니다.

### 참고
- **포크 확장 기능 포함:** Android 온라인 대화, 실시간 세션 출력 속도, 선택형 승인 알림, 실시간 푸시, `/api/query/*` 통합 조회 및 17개 MCP 도구 확장, 데스크톱 `local` 모드와 `127.0.0.1` 루프백 브리지를 포함합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-Setup-0.99.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.99.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.99.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **上流 v0.94.0 同期と統一クォータアカウント管理：** [Javis603/token-monitor v0.94.0](https://github.com/Javis603/token-monitor/releases/tag/v0.94.0)（`5888563c`）を取り込み、統一クォータアカウント管理、デバイス間 `limitAccountPresentation` 同期（カスタム名・プロバイダー別並び順）、Alibaba Bailian CLI クォータ取得（中国／国際リージョン分離）、設定のツール・プロバイダーグループ表示、日別トレンド詳細表示、正確なトレンドトークン数表示オプションを追加しました。
- **OpenClaw・レポートのアカウント表示対応：** `src/shared/aiReportAnalyzer.js`、`src/shared/openclawQueries.js`、`src/electron/openclawBridge.js` を更新し、OpenClaw 通知や `/api/query/*`、レポートでも同期済み `limitAccountPresentation` のカスタム名と Alibaba の `accountSelectionKey`（`region`）を反映します。

### 改善
- **セッションタイトル・集計精度・パフォーマンス：** カスタムスキャンパスから Codex セッションタイトルを解決し、ウィジェット各画面のコンテキストメーター位置を揃え、クォータ取得待ち時に「Checking」を表示します。また、同期クライアント追跡解除時の二重カウント防止、Linux タイトルバー右クリック後のポインター停止修正、Hub 更新時のメインプロセス負荷軽減を行いました。

### 注意
- **フォーク拡張機能を収録：** Android 向けオンライン会話閲覧、リアルタイムセッション出力レート、任意の承認通知、リアルタイムプッシュ通知、`/api/query/*` 統合クエリと 17 種の MCP ツール、デスクトップ `local` モードおよび `127.0.0.1` ループバックブリッジを含みます。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-Setup-0.99.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.99.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.99.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.99.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.99.0/Token-Monitor-0.99.0-x86_64.AppImage)

</details>

</details>
