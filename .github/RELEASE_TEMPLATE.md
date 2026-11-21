# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Upstream v0.95.0 Sync — Junie & OpenCodeReview:** Synced [Javis603/token-monitor v0.95.0](https://github.com/Javis603/token-monitor/releases/tag/v0.95.0) (`4a36ad4f`), adding usage tracking, icons, and live refresh for Junie and OpenCodeReview sessions.
- **Session Context Meters:** Displays context usage and remaining capacity for recent Grok Build, WorkBuddy, and CatPaw sessions when available.

### Changed
- **Main Screen & Settings Layout:** Redesigned Main Screen settings with sidebar view configuration, reordering, and hidden-view restore; grouped General (with GitHub star count), Appearance (with live color picker), Collection, and AI Tool Limits into structured cards.
- **Electron 45.4.1:** Upgraded bundled Electron runtime to `45.4.1`.

### Improved
- **Edge Dock Colors, Usage Updates & Windows Compatibility:** Preserved vendor colors on Edge Dock quota rings and running tool icons in light/dark themes, cut main-process work during usage refreshes and session row updates, and fixed Windows folder forwarding and plugin UI test scripts.

### Notes
- **OpenClaw & Fork Capabilities:** Includes online Antigravity / Codex conversations for Android, live session output rates, optional approval alerts, real-time session/approval/quota/service-incident pushes, unified `/api/query/*` & 17-tool MCP endpoints, and Desktop `local`-mode loopback bridge.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-Setup-0.100.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.100.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.100.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.100.0-x86_64.AppImage` then run it.

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
- **同步上游 v0.95.0 — Junie 与 OpenCodeReview：** 合并 [Javis603/token-monitor v0.95.0](https://github.com/Javis603/token-monitor/releases/tag/v0.95.0)（`4a36ad4f`），新增 Junie 与 OpenCodeReview 本地会话 Token 用量追踪、图标与日志变更自动刷新。
- **会话上下文用量：** 在数据可用时，为近期 Grok Build、WorkBuddy 和 CatPaw 会话展示上下文占用量与剩余容量。

### 变更
- **主画面设置与设置页卡片重构：** 主画面设置支持通过侧栏配置各视图、调整可见视图顺序及恢复隐藏视图；常规（新增 GitHub Star 显示）、外观（新增实时预览取色器）、采集与 AI 工具额度统一改用分组卡片布局。
- **Electron 45.4.1：** 升级内置 Electron 运行时至 `45.4.1`。

### 改进
- **Edge Dock 配色、刷新性能与 Windows 兼容：** 在浅色与深色主题下保留 Edge Dock 额度圆环和运行中工具图标的服务商配色，降低用量刷新与会话列表渲染开销，并修复 Windows 目录透传与插件 UI 脚本兼容问题。

### 说明
- **包含本分支全部扩展能力：** 涵盖安卓端在线对话、实时会话输出速率、可选审批提醒、实时推送、`/api/query/*` 统一查询与 17 工具 MCP 扩展、桌面端 `local` 模式支持及本机 `127.0.0.1` 回环桥接。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-Setup-0.100.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.100.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.100.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.100.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.99.0...v0.100.0">v0.99.0...v0.100.0</a></summary>

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
- **同步上游 v0.95.0 — Junie 與 OpenCodeReview：** 合併 [Javis603/token-monitor v0.95.0](https://github.com/Javis603/token-monitor/releases/tag/v0.95.0)（`4a36ad4f`），新增 Junie 與 OpenCodeReview 本機工作階段 Token 用量追蹤、圖示與日誌變更自動更新。
- **工作階段上下文用量：** 在資料可用時，為近期 Grok Build、WorkBuddy 與 CatPaw 工作階段顯示上下文佔用量與剩餘容量。

### 變更
- **主畫面設定與設定頁卡片重構：** 主畫面設定支援透過側欄設定各檢視、調整可見檢視順序及還原隱藏檢視；一般（新增 GitHub Star 顯示）、外觀（新增即時預覽取色器）、採集與 AI 工具額度統一改用分組卡片佈局。
- **Electron 45.4.1：** 升級內建 Electron 執行期至 `45.4.1`。

### 改進
- **Edge Dock 配色、更新效能與 Windows 相容：** 在淺色與深色主題下保留 Edge Dock 額度圓環與執行中工具圖示的服務商配色，降低用量更新與工作階段列表渲染負荷，並修正 Windows 目錄透傳與外掛 UI 腳本相容問題。

### 說明
- **包含本分支全部擴充能力：** 涵蓋 Android 端線上對話、即時工作階段輸出速率、可選審批提醒、即時推送、`/api/query/*` 統一查詢與 17 工具 MCP 擴充，以及桌面端 `local` 模式與本機 `127.0.0.1` 迴環橋接。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-Setup-0.100.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.100.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **업스트림 v0.95.0 동기화 — Junie 및 OpenCodeReview:** [Javis603/token-monitor v0.95.0](https://github.com/Javis603/token-monitor/releases/tag/v0.95.0)(`4a36ad4f`)을 병합해 Junie와 OpenCodeReview 로컬 세션 토큰 사용량 추적, 아이콘 및 자동 갱신을 추가했습니다.
- **세션 컨텍스트 표시:** 데이터가 있는 최근 Grok Build, WorkBuddy, CatPaw 세션의 컨텍스트 사용량과 남은 용량을 표시합니다.

### 변경
- **메인 화면 및 설정 레이아웃 개편:** 메인 화면 설정에서 사이드바로 각 보기를 구성·정렬·복원할 수 있으며, 일반(GitHub Star 표시 추가), 외관(실시간 색상 선택기 추가), 수집, AI 도구 한도 설정을 그룹화된 카드로 정리했습니다.
- **Electron 45.4.1:** 내장 Electron 런타임을 `45.4.1`로 업그레이드했습니다.

### 개선
- **Edge Dock 색상, 사용량 갱신 및 Windows 호환성:** 밝은·어두운 테마에서 Edge Dock 한도 링과 실행 중 도구 아이콘의 제공업체 색상을 유지하고, 사용량 갱신 및 세션 목록 처리 부담을 줄였으며 Windows 폴더 전달과 플러그인 UI 테스트 스크립트를 수정했습니다.

### 참고
- **포크 확장 기능 포함:** Android 온라인 대화, 실시간 세션 출력 속도, 선택형 승인 알림, 실시간 푸시, `/api/query/*` 통합 조회 및 17개 MCP 도구 확장, 데스크톱 `local` 모드와 `127.0.0.1` 루프백 브리지를 포함합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-Setup-0.100.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.100.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **上流 v0.95.0 同期 — Junie と OpenCodeReview：** [Javis603/token-monitor v0.95.0](https://github.com/Javis603/token-monitor/releases/tag/v0.95.0)（`4a36ad4f`）を取り込み、Junie と OpenCodeReview のローカルセッションのトークン使用量追跡・アイコン・自動更新を追加しました。
- **セッションコンテキスト表示：** データ取得時に Grok Build、WorkBuddy、CatPaw の最近セッションのコンテキスト使用量と残り容量を表示します。

### 変更
- **メイン画面と設定レイアウト刷新：** サイドバーから各ビューの設定・並び替え・非表示ビューの復元が可能になり、一般（GitHub Star 数表示を追加）・外観（リアルタイムカラーピッカーを追加）・収集・AI ツール制限をグループ化カードへ整理しました。
- **Electron 45.4.1：** 同梱 Electron ランタイムを `45.4.1` へ更新しました。

### 改善
- **Edge Dock 配色・更新負荷・Windows 互換性：** ライト／ダークテーマで Edge Dock の利用枠リングと実行中ツールアイコンのプロバイダー色を保持し、使用量更新やセッション一覧の負荷を軽減するとともに Windows フォルダ転送とプラグイン UI テストスクリプトを修正しました。

### 注意
- **フォーク拡張機能を収録：** Android 向けオンライン会話閲覧、リアルタイムセッション出力レート、任意の承認通知、リアルタイムプッシュ通知、`/api/query/*` 統合クエリと 17 種の MCP ツール、デスクトップ `local` モードおよび `127.0.0.1` ループバックブリッジを含みます。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-Setup-0.100.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.100.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.100.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.0/Token-Monitor-0.100.0-x86_64.AppImage)

</details>

</details>
