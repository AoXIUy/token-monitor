# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Antigravity quota auto-switch and account weights:** Automatically detect when local Antigravity hits a 5-hour or weekly quota limit, refresh the AGY account pool, and switch to the best eligible account using automatic quota scoring or custom per-account weights (`1–100`), with configurable pool scope, remaining threshold, cooldown, and active-session deferral.

### Fixed
- **Windows credential manager decoding:** Decode Windows Credential Manager payloads for Claude and Antigravity Manager via `koffi.decode` instead of `koffi.view` and unpack `@koromix` native assets in `asarUnpack` to prevent V8 Sandbox crashes, supporting both UTF-8 and UTF-16LE credential blobs.
- **Antigravity local credential scanning:** Strip leading UTF-8 BOMs from credential files, switch to non-blocking async reads with per-source error isolation, and apply read-only SQLite timeouts when scanning local Antigravity state databases.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-Setup-0.105.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.105.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.105.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.105.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.105.0-x86_64.AppImage` then run it.

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
- **Antigravity 限额自动切号与账号权重：** 检测到本地 Antigravity 触发 5 小时或周限时，自动刷新 AGY 账号池并切换到最合适的可用账号；支持「自动优选」与「自定义账号权重（1–100）」两种策略，并可配置监控分组、剩余阈值、冷却时间及活跃会话输出保护。

### 修复
- **Windows 凭据管理器解码：** Claude 与 Antigravity 账号管理改用 `koffi.decode` 解析 Windows Credential Manager 凭据并在 `asarUnpack` 中解包 `@koromix` 原生资产，避免 V8 Sandbox 崩溃，同时兼容 UTF-8 与 UTF-16LE 凭据载荷。
- **Antigravity 本机凭据扫描加固：** 自动剥离凭据文件开头的 UTF-8 BOM、切换为按来源隔离错误的异步读取，并在读取本机 Antigravity 状态库时启用只读模式与超时保护。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-Setup-0.105.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.105.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.105.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.105.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.105.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.104.0...v0.105.0">v0.104.0...v0.105.0</a></summary>

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
- **Antigravity 限額自動切號與帳號權重：** 偵測到本機 Antigravity 觸發 5 小時或週限時，自動重新整理 AGY 帳號池並切換至最合適的可用帳號；支援「自動優選」與「自訂帳號權重（1–100）」兩種策略，並可設定監控分組、剩餘閾值、冷卻時間與活躍工作階段輸出保護。

### 修復
- **Windows 憑證管理員解碼：** Claude 與 Antigravity 帳號管理改用 `koffi.decode` 解析 Windows Credential Manager 憑證並在 `asarUnpack` 中解包 `@koromix` 原生資源，避免 V8 Sandbox 當機，同時相容 UTF-8 與 UTF-16LE 憑證內容。
- **Antigravity 本機憑證掃描加固：** 自動剝離憑證檔案開頭的 UTF-8 BOM、改用依來源隔離錯誤的非同步讀取，並在讀取本機 Antigravity 狀態庫時啟用唯讀模式與逾時保護。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-Setup-0.105.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.105.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.105.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **Antigravity 한도 자동 전환 및 계정 가중치:** 로컬 Antigravity가 5시간 또는 주간 한도에 도달하면 자동으로 AGY 계정 풀을 새로고침하고 최적의 계정으로 전환합니다. 자동 점수 최적화 또는 사용자 지정 계정 가중치(`1–100`)를 선택할 수 있으며, 모니터링 그룹, 잔여 임계값, 재전환 대기 시간, 활성 세션 지연 보호 설정을 지원합니다.

### 수정
- **Windows 자격 증명 관리자 디코딩:** Claude 및 Antigravity 관리자에서 `koffi.view` 대신 `koffi.decode`로 Windows 자격 증명 페이로드를 디코딩하고 `asarUnpack`에 `@koromix` 네이티브 자산을 포함해 V8 Sandbox 충돌을 방지하며 UTF-8 및 UTF-16LE 형식을 모두 지원합니다.
- **Antigravity 로컬 자격 증명 스캔 강화:** 자격 증명 파일의 선행 UTF-8 BOM을 제거하고 소스별 오류 격리를 적용한 비차단 비동기 읽기로 전환했으며, 로컬 상태 DB 조회 시 읽기 전용 모드와 타임아웃을 적용했습니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-Setup-0.105.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.105.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.105.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **Antigravity 上限時の自動切替とアカウント重み：** ローカルの Antigravity が 5 時間または週間の上限に達した際、AGY アカウントプールを更新して最適なアカウントへ自動切替します。自動最適化またはカスタム重み（`1–100`）の選択、監視グループ、残量しきい値、クールダウン、アクティブセッション保護を設定できます。

### 修正
- **Windows 資格情報マネージャーのデコード：** Claude と Antigravity マネージャーで `koffi.view` の代わりに `koffi.decode` を使用し、`asarUnpack` に `@koromix` ネイティブ資産を追加して V8 Sandbox クラッシュを防止するとともに UTF-8 と UTF-16LE の両方に対応しました。
- **Antigravity ローカル資格情報スキャンの強化：** 資格情報ファイル先頭の UTF-8 BOM を除去し、ソースごとにエラーを分離した非同期読み取りと読み取り専用 SQLite タイムアウトを適用しました。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-Setup-0.105.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.105.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.105.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.105.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.105.0/Token-Monitor-0.105.0-x86_64.AppImage)

</details>

</details>
