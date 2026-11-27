# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Antigravity sync timeout budgets:** Raise the background auto-sync timeout from 30s to 150s and the explicit tool rescan timeout to 300s so large multi-hundred-session local histories finish writing `manifest.json` instead of reporting false `sync-timeout` warnings.
- **Non-blocking Antigravity background sync:** Run anchored Antigravity loopback RPC syncs outside `tickInFlight` so live session status polling, direct SQLite conversation updates, and other AI tool file-watch refreshes stay responsive during long exports.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-Setup-0.106.1.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.106.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.1-x86_64.AppImage` then run it.

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
- **Antigravity 同步超时阈值优化：** 将后台自动同步超时从 30 秒提升至 150 秒、手动「重新扫描这个工具」超时提升至 300 秒，避免本机累计上百个历史会话时串行导出在中途被强杀并误报自动同步超时。
- **Antigravity 后台同步非阻塞化：** 在建立基准锚点后将 Antigravity 本地回环 RPC 同步移出 `tickInFlight` 主锁执行，确保长耗时导出期间实时会话状态轮询、本地 SQLite 会话库直读及其他 AI 工具的文件监听增量刷新保持秒级响应。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-Setup-0.106.1.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.106.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.1-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.106.0...v0.106.1">v0.106.0...v0.106.1</a></summary>

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
- **Antigravity 同步逾時門檻最佳化：** 將背景自動同步逾時由 30 秒提高至 150 秒、手動「重新掃描這個工具」逾時提高至 300 秒，避免本機累積數百個歷史工作階段時序列匯出在中途被強制終止並誤報自動同步逾時。
- **Antigravity 背景同步非阻塞化：** 在建立基準錨點後將 Antigravity 本機回送 RPC 同步移出 `tickInFlight` 主鎖執行，確保長時間匯出期間即時工作階段狀態輪詢、本機 SQLite 對話資料庫直讀及其他 AI 工具的檔案監聽增量更新維持秒級回應。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-Setup-0.106.1.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.106.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **Antigravity 동기화 타임아웃 한도 상향:** 백그라운드 자동 동기화 타임아웃을 30초에서 150초로, 수동 ‘이 도구 다시 검사’ 타임아웃을 300초로 늘려 수백 개의 로컬 세션 기록을 내보낼 때 중간에 종료되어 `sync-timeout` 경고가 잘못 표시되는 문제를 해결했습니다.
- **비차단 Antigravity 백그라운드 동기화:** 기준 앵커가 설정된 후 Antigravity 로컬 루프백 RPC 동기화를 `tickInFlight` 밖에서 실행하여 긴 내보내기 중에도 실시간 세션 상태 폴링, 로컬 SQLite 대화 DB 직접 읽기, 다른 AI 도구의 파일 감시 갱신이 지연 없이 응답하도록 개선했습니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-Setup-0.106.1.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.106.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **Antigravity 同期タイムアウト上限の引き上げ：** バックグラウンド自動同期のタイムアウトを 30 秒から 150 秒へ、手動「このツールを再スキャン」のタイムアウトを 300 秒へ引き上げ、数百件のローカル履歴セッションがある環境でも `manifest.json` の書き込みまで完了し誤った `sync-timeout` 警告が出ないよう修正しました。
- **Antigravity バックグラウンド同期の非ブロッキング化：** アンカー確立後の Antigravity ローカル RPC 同期を `tickInFlight` の外で実行し、長時間のエクスポート中もリアルタイム稼働状態のポーリング、ローカル SQLite 会話 DB の直接読み取り、他 AI ツールのファイル監視更新が即座に応答するよう改善しました。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-Setup-0.106.1.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.106.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.106.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.1/Token-Monitor-0.106.1-x86_64.AppImage)

</details>

</details>
