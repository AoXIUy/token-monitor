# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Antigravity RPC Daemon Discovery & Quota Pool Mapping:** Added `<root>/daemon/*.json` PID-joined port discovery for tokenless Antigravity `2.31+` / `2.33` / `2.34` language servers without blocking on `lsof`, and mapped newer Gemini 4 quota models without `pro`/`flash`/`argon` suffixes into `Gemini Pro`.
- **Antigravity Live Session Activity & Completion:** Added a shared Antigravity live session activity provider (`src/shared/providers/antigravity/sessionActivity.js`), extracted `turnEnded` cleanly from `conversation_summaries.db`, and preserved activity timestamps on catalog refreshes.
- **Antigravity Self-Sync Diagnostics:** Safely drained `tokscale` child stdout and logged actionable diagnostics when `tokscale antigravity sync` returns zero cached sessions while export candidates exist.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-Setup-0.100.1.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.100.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.100.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.100.1-x86_64.AppImage` then run it.

### Other notes

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale is bundled with this app and updated through Token Monitor releases. See **Settings → General → Advanced → Tokscale** for the version and fork build identifier. Tokscale is MIT, open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 修复
- **Antigravity 额度与守护进程探测：** 新增无 token Antigravity `2.31+` / `2.33` / `2.34` 语言服务的 `<root>/daemon/*.json` PID 端口关联发现，不再阻塞于 `lsof`，并将不带 `pro`/`flash`/`argon` 后缀的新 Gemini 4 模型归入 `Gemini Pro` 额度池。
- **Antigravity 实时会话状态与完成检测：** 新增共享实时会话活动提供器（`src/shared/providers/antigravity/sessionActivity.js`），基于 `conversation_summaries.db` 提取 `turnEnded`，并在 catalog 刷新时保留准确的活跃时间戳。
- **Antigravity 同步诊断增强：** 安全排空 `tokscale` 子进程标准输出，并在存在导出候选但缓存会话为空时输出可定位诊断日志。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-Setup-0.100.1.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.100.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.100.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.100.1-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.100.0...v0.100.1">v0.100.0...v0.100.1</a></summary>

<!-- github-generated-release-notes -->

</details>

<details>
<summary>繁體中文 · 한국어 · 日本語</summary>

<details>
<summary><strong>繁體中文</strong></summary>

## 繁體中文

## 更新內容

<!-- app-update-notes:zh-TW:start -->
### 修復
- **Antigravity 額度與背景服務探測：** 新增無 token Antigravity `2.31+` / `2.33` / `2.34` 語言伺服器的 `<root>/daemon/*.json` PID 連接埠關聯探索，不再卡在 `lsof`，並將不含 `pro`/`flash`/`argon` 後綴的新 Gemini 4 模型對應至 `Gemini Pro` 額度池。
- **Antigravity 即時工作階段狀態與完成偵測：** 新增共用即時工作階段活動提供器（`src/shared/providers/antigravity/sessionActivity.js`），從 `conversation_summaries.db` 提取 `turnEnded` 並在 catalog 重新整理時保留活動時間戳記。
- **Antigravity 同步診斷增強：** 安全排空 `tokscale` 子行程標準輸出，並在存在匯出候選但快取工作階段為空時記錄診斷日誌。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-Setup-0.100.1.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.100.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **Antigravity RPC 데몬 탐색 및 할당량 풀 매핑:** 토큰 없는 Antigravity `2.31+` / `2.33` / `2.34` 언어 서버를 위해 `lsof`에서 멈추지 않는 `<root>/daemon/*.json` PID 기반 포트 탐색을 추가하고, `pro`/`flash`/`argon` 접미사가 없는 신규 Gemini 4 모델을 `Gemini Pro` 풀에 매핑했습니다.
- **Antigravity 실시간 세션 상태 및 완료 감지:** 공유 실시간 세션 활동 공급자(`src/shared/providers/antigravity/sessionActivity.js`)를 추가하고 `conversation_summaries.db`에서 `turnEnded` 상태를 추출하며 catalog 갱신 시 활동 타임스탬프를 보존합니다.
- **Antigravity 자체 동기화 진단:** `tokscale` 자식 stdout을 안전하게 비우고 내보내기 후보가 있는데 캐시된 세션이 0개인 경우 진단 로그를 남깁니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-Setup-0.100.1.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.100.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **Antigravity RPC デーモン検出とクォータプール割り当て：** トークンレスの Antigravity `2.31+` / `2.33` / `2.34` 言語サーバー向けに `<root>/daemon/*.json` と PID によるポート検出を追加して `lsof` 停止を回避し、`pro`/`flash`/`argon` 接尾辞のない新しい Gemini 4 モデルを `Gemini Pro` プールへ割り当てます。
- **Antigravity リアルタイムセッション状態と完了検出：** 共有のリアルタイムセッション活動プロバイダー（`src/shared/providers/antigravity/sessionActivity.js`）を追加し、`conversation_summaries.db` から `turnEnded` を抽出して catalog 更新時も活動タイムスタンプを保持します。
- **Antigravity 自己同期の診断強化：** `tokscale` 子プロセスの標準出力を安全に排出し、エクスポート候補があるのにキャッシュセッションが 0 件の場合に診断ログを出力します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-Setup-0.100.1.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.100.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.100.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.100.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.100.1/Token-Monitor-0.100.1-x86_64.AppImage)

</details>

</details>
