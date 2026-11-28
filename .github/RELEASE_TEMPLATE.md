# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Windows Antigravity 2.x account switching and credential persistence:** Read `product.json` and `package.json` directly from `resources/app.asar` so Antigravity 2.x desktop installs reliably resolve their version and update system keyring credentials, perform clean full restarts for stdin-bridge desktop language servers and unverified Windows hot-switches, filter Electron worker processes via `ParentProcessId`, and add bounded Windows atomic-rename and `SQLITE_BUSY` retries.
- **Zero-quota busy-deferral recovery and safer task auto-resume:** Bypass the 180-second busy-deferral wait at 0% quota when a model turn has already halted to idle while background shell tasks remain active, resume recent conversations halted by explicit quota errors on manual switches without disturbing completed turns, and support Windows `agentapi.bat` / `agentapi.cmd` wrappers and Unix-second SQLite timestamps.
- **Native Win32 RPC socket discovery, packaging, and Hub 413 handling:** Query `iphlpapi.dll` `GetExtendedTcpTable` via Koffi on Windows to avoid spawning PowerShell processes during local Antigravity RPC probes, align Windows `electron-builder` packaging scripts with `scripts/electron-builder.config.js`, and drain bounded request bytes before closing HTTP `413` sockets on Windows Winsock.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-Setup-0.106.4.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.106.4-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.4-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.4-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.4-x86_64.AppImage` then run it.

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
- **Windows 版 Antigravity 2.x 切号与凭据写入加固：** 支持直接从 `resources/app.asar` 解析 `product.json` 与 `package.json` 版本号以确保 Antigravity 2.x 桌面端可靠更新系统凭据库，识别 stdin 桥接桌面语言服务与未通过核验的 Windows 热切换并自动升级为干净完整重启，结合 `ParentProcessId` 过滤 Electron 工作子进程，并为原子文件替换与 `SQLITE_BUSY` 增加有界重试。
- **0% 配额忙等待防卡死与中断对话自动续跑增强：** 当模型轮次已停机回到空闲态而仅剩后台终端任务保持活跃时跳过 180 秒忙等待延迟并立即切号，支持手动切号自动续跑近期因明确配额错误中断的对话且不打扰正常完结会话，并兼容 Windows `agentapi.bat` / `agentapi.cmd` 包装脚本与秒级 SQLite 时间戳。
- **Win32 原生 RPC 端口探测、打包配置与 Hub 413 响应优化：** 在 Windows 下通过 Koffi 直接调用 `iphlpapi.dll` `GetExtendedTcpTable` 取代频繁拉起 PowerShell 子进程探测本地 Antigravity RPC 端口，对齐 Windows `electron-builder` 打包脚本配置，并在 Windows Winsock 关闭 HTTP `413` 连接前有界排空请求体以避免连接重置丢失响应。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-Setup-0.106.4.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.106.4-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.4-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.4-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.4-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.106.3...v0.106.4">v0.106.3...v0.106.4</a></summary>

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
- **Windows 版 Antigravity 2.x 切號與憑證寫入強化：** 支援直接從 `resources/app.asar` 解析 `product.json` 與 `package.json` 版本號以確保 Antigravity 2.x 桌面版可靠更新系統憑證庫，識別 stdin 橋接桌面語言服務與未通過核驗的 Windows 熱切換並自動升級為乾淨完整重啟，結合 `ParentProcessId` 過濾 Electron 工作子程序，並為原子檔案替換與 `SQLITE_BUSY` 增加有界重試。
- **0% 配額忙等待防卡死與中斷對話自動續跑增強：** 當模型輪次已停機回到閒置態而僅剩背景終端機任務保持活躍時跳過 180 秒忙等待延遲並立即切號，支援手動切號自動續跑近期因明確配額錯誤中斷的對話且不打擾正常完結工作階段，並相容 Windows `agentapi.bat` / `agentapi.cmd` 包裝指令碼與秒級 SQLite 時間戳。
- **Win32 原生 RPC 連接埠探測、封裝設定與 Hub 413 回應最佳化：** 在 Windows 下透過 Koffi 直接呼叫 `iphlpapi.dll` `GetExtendedTcpTable` 取代頻繁啟動 PowerShell 子程序探測本機 Antigravity RPC 連接埠，對齊 Windows `electron-builder` 封裝指令碼設定，並在 Windows Winsock 關閉 HTTP `413` 連線前有界排空請求內容以避免連線重設遺失回應。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-Setup-0.106.4.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.106.4-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.4-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **Windows Antigravity 2.x 계정 전환 및 자격 증명 저장 강화:** `resources/app.asar`에서 `product.json` 및 `package.json` 버전을 직접 읽어 Antigravity 2.x 데스크톱 설치본의 시스템 키링 자격 증명을 안정적으로 갱신하고, stdin 브리지 데스크톱 언어 서버와 미검증 Windows 핫스위치를 깔끔한 전체 재시작으로 전환하며, `ParentProcessId`로 Electron 워커 프로세스를 필터링하고 Windows 원자적 파일 교체 및 `SQLITE_BUSY` 재시도를 추가했습니다.
- **0% 할당량 대기 교착 해소 및 안전한 작업 자동 재개:** 모델 턴이 이미 유휴 상태로 멈추고 백그라운드 셸 작업만 남아 있을 때 0% 할당량에서 180초 지연 대기를 건너뛰어 즉시 전환하고, 완료된 대화는 건드리지 않은 채 수동 전환 시 명확한 할당량 오류로 중단된 최근 대화를 자동 재개하며, Windows `agentapi.bat` / `agentapi.cmd` 래퍼와 초 단위 SQLite 타임스탬프를 지원합니다.
- **네이티브 Win32 RPC 소켓 탐색, 패키징 및 Hub 413 처리 개선:** Windows에서 로컬 Antigravity RPC 프로브 시 PowerShell 프로세스를 반복 실행하는 대신 Koffi를 통해 `iphlpapi.dll` `GetExtendedTcpTable`을 직접 조회하고, Windows `electron-builder` 스크립트를 `scripts/electron-builder.config.js`와 정렬하며, Windows Winsock에서 HTTP `413` 소켓을 닫기 전에 제한된 요청 바이트를 비워 응답 유실을 방지합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-Setup-0.106.4.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.106.4-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.4-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **Windows 版 Antigravity 2.x のアカウント切替と認証情報保存の強化：** `resources/app.asar` から `product.json` と `package.json` を直接読み取って Antigravity 2.x デスクトップ版のバージョン判定とシステムキーリング更新を確実に行い、stdin ブリッジ型デスクトップ言語サーバーおよび未検証の Windows ホットスイッチをクリーンな完全再起動へ切り替え、`ParentProcessId` による Electron ワーカープロセスの除外と Windows のアトミックリネームおよび `SQLITE_BUSY` の有界リトライを追加しました。
- **残量 0% 時のビジー待機スタック解消と安全なタスク自動再開：** モデルターンが既にアイドル停止しバックグラウンドのシェルタスクのみが残っている場合は残量 0% 到達時の 180 秒待機をスキップして即座に切り替え、完了済み会話に影響を与えず手動切替時にも明確なクォータエラーで停止した直近の会話を自動再開し、Windows の `agentapi.bat` / `agentapi.cmd` ラッパーと秒単位の SQLite タイムスタンプに対応しました。
- **Win32 ネイティブ RPC ソケット検出・パッケージング・Hub 413 応答の改善：** Windows のローカル Antigravity RPC プローブで PowerShell プロセス起動を避けて Koffi 経由で `iphlpapi.dll` の `GetExtendedTcpTable` を直接照会し、Windows の `electron-builder` スクリプトを `scripts/electron-builder.config.js` に統一するとともに、Windows Winsock で HTTP `413` ソケットを閉じる前に上限付きでリクエストボディを読み捨てて応答消失を防止しました。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-Setup-0.106.4.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.106.4.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.106.4-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.4-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.4/Token-Monitor-0.106.4-x86_64.AppImage)

</details>

</details>
