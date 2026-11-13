# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- Optional read-only approval alerts for Codex (`PermissionRequest`) and Antigravity (`PreToolUse`) when a session pauses for confirmation.
- Non-blocking desktop hooks forward confirmation alerts over a permission-restricted local IPC bridge to the Node Hub (`POST /api/approval-alerts` / `GET /api/approval-alerts`) and immediately return native desktop prompting.
- Desktop Multi-Device Sync settings add one-click Codex / Antigravity hook installers and matcher configuration; headless Agent and standalone Node Hub support `--approval-alerts` and `TOKEN_MONITOR_APPROVAL_ALERTS=1`.
### Notes
- Approval alerts are read-only and disabled by default across Hub, collector, and Android; confirmations always stay on the desktop. Node Hub keeps alerts in memory only for 2 minutes; Cloudflare Worker does not implement this route.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-Setup-0.93.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.93.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.93.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.93.0-x86_64.AppImage` then run it.

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
- 新增可选的 Codex（`PermissionRequest`）与 Antigravity（`PreToolUse`）只读审批提醒，在会话暂停等待确认时通知手机端。
- 非阻塞桌面端 Hook 通过受权限保护的本地 IPC 桥将提醒转发至 Node Hub（`POST /api/approval-alerts` / `GET /api/approval-alerts`），并立即返回桌面原生确认弹窗。
- 桌面端「多设备同步」设置新增一键安装 Codex / Antigravity Hook 与匹配规则配置；独立 Hub 与无界面 Agent 支持 `--approval-alerts` 与 `TOKEN_MONITOR_APPROVAL_ALERTS=1`。
### 说明
- 审批提醒严格只读且在 Hub、采集端与 Android 均默认关闭，允许与拒绝操作始终在电脑端完成；Node Hub 仅在内存中保留 2 分钟，Cloudflare Worker 不实现此接口。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-Setup-0.93.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.93.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.93.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.93.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.92.0...v0.93.0">v0.92.0...v0.93.0</a></summary>

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
- 新增可選的 Codex（`PermissionRequest`）與 Antigravity（`PreToolUse`）唯讀審批提醒，在工作階段暫停等待確認時通知手機端。
- 非阻塞桌面端 Hook 透過受權限保護的本機 IPC 橋將提醒轉發至 Node Hub（`POST /api/approval-alerts` / `GET /api/approval-alerts`），並立即返回桌面原生確認視窗。
- 桌面端「多裝置同步」設定新增一鍵安裝 Codex / Antigravity Hook 與比對規則設定；獨立 Hub 與無介面 Agent 支援 `--approval-alerts` 與 `TOKEN_MONITOR_APPROVAL_ALERTS=1`。
### 說明
- 審批提醒為嚴格唯讀且於 Hub、擷取端與 Android 皆預設關閉，允許與拒絕操作一律在電腦端完成；Node Hub 僅於記憶體保留 2 分鐘，Cloudflare Worker 不實作此路由。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-Setup-0.93.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.93.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- 세션이 확인 대기로 일시 중지될 때 Codex(`PermissionRequest`) 및 Antigravity(`PreToolUse`)용 선택적 읽기 전용 승인 알림을 추가했습니다.
- 비차단 데스크톱 훅이 권한이 제한된 로컬 IPC 브리지를 통해 Node Hub(`POST /api/approval-alerts` / `GET /api/approval-alerts`)로 알림을 전달하고 즉시 데스크톱 기본 확인 흐름을 반환합니다.
- 데스크톱 다중 기기 동기화 설정에 원클릭 Codex / Antigravity 훅 설치 및 매처 설정을 추가했으며, 독립 실행형 Hub와 헤드리스 Agent는 `--approval-alerts` 및 `TOKEN_MONITOR_APPROVAL_ALERTS=1`을 지원합니다.
### 참고
- 승인 알림은 읽기 전용이며 Hub, 수집기, Android에서 기본 비활성화되어 있습니다. 허용/거부 결정은 항상 데스크톱에서 처리하며, Node Hub는 알림을 메모리에만 2분간 보관하고 Cloudflare Worker는 이 경로를 구현하지 않습니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-Setup-0.93.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.93.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- セッションが確認待ちで一時停止した際に通知する、Codex（`PermissionRequest`）および Antigravity（`PreToolUse`）向けの読み取り専用承認通知（オプション）を追加しました。
- 非ブロッキングのデスクトップフックが権限制限付きローカル IPC ブリッジ経由で Node Hub（`POST /api/approval-alerts` / `GET /api/approval-alerts`）へ通知を送信し、直ちにデスクトップ標準の確認動作へ戻ります。
- デスクトップのマルチデバイス同期設定にワンクリックの Codex / Antigravity フック導入とマッチャー設定を追加し、単体 Hub とヘッドレス Agent で `--approval-alerts` / `TOKEN_MONITOR_APPROVAL_ALERTS=1` に対応しました。
### 注意
- 承認通知は読み取り専用であり、Hub・コレクター・Android のすべてで既定無効です。許可・拒否の操作は常にデスクトップ側で行い、Node Hub はメモリ上に 2 分間のみ保持します（Cloudflare Worker は未実装）。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-Setup-0.93.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.93.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.93.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.0/Token-Monitor-0.93.0-x86_64.AppImage)

</details>

</details>
