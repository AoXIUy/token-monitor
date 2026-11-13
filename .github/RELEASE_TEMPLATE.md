# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- Probe active Windows named pipes when starting the local approval alert IPC bridge so competing instances cleanly receive `already_owned` instead of opening duplicate pipe listeners.
- Clean up idle probe timers on socket close and give subprocess hook dispatch assertions headroom on busy Windows runners while still asserting non-blocking return.
### Notes
- Carries forward all 0.93.0 read-only Codex (`PermissionRequest`) and Antigravity (`PreToolUse`) approval alert features; alerts remain disabled by default and confirmations always stay on the desktop.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-Setup-0.93.1.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.93.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.93.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.93.1-x86_64.AppImage` then run it.

### Other notes

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale is bundled with this app and updated through Token Monitor releases. See **Settings → Advanced → Tokscale** for the version and fork build identifier. Tokscale is MIT, open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 修复
- 启动本地审批提醒 IPC 桥时在 Windows 命名管道上先执行存活探测，避免并发实例打开重复监听并确保返回 `already_owned`。
- 在连接关闭时及时清理读取超时定时器，并在高负载 Windows 运行环境下保持钩子子进程非阻塞时序检查的稳定余量。
### 说明
- 包含 0.93.0 全部只读 Codex（`PermissionRequest`）与 Antigravity（`PreToolUse`）审批提醒功能；开关默认关闭，允许与拒绝操作始终留在电脑端完成。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-Setup-0.93.1.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.93.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.93.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.93.1-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.93.0...v0.93.1">v0.93.0...v0.93.1</a></summary>

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
- 啟動本機審批提醒 IPC 橋時於 Windows 命名管道先執行存活探測，確保重複實例返回 `already_owned` 而非建立重複監聽。
- 連線關閉時即時清除逾時計時器，並為高負載 Windows 測試環境保留足夠的非阻塞行程啟動餘裕。
### 說明
- 保留 0.93.0 全部 Codex（`PermissionRequest`）與 Antigravity（`PreToolUse`）唯讀審批提醒功能；預設維持關閉，所有允許或拒絕操作均在電腦端完成。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-Setup-0.93.1.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.93.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- 로컬 승인 알림 IPC 브리지 시작 시 Windows 명명된 파이프의 활성 상태를 먼저 확인해 중복 인스턴스가 리스너를 겹쳐 열지 않고 `already_owned`를 반환하도록 수정했습니다.
- 소켓 종료 시 대기 타이머를 즉시 정리하고 부하가 높은 Windows 실행 환경에서도 비차단 훅 프로세스 검증이 안정적으로 통과하도록 여유 시간을 조정했습니다.
### 참고
- 0.93.0의 모든 Codex(`PermissionRequest`) 및 Antigravity(`PreToolUse`) 읽기 전용 승인 알림 기능을 포함하며, 기본값은 비활성화이고 허용/거부 결정은 항상 데스크톱에서 진행됩니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-Setup-0.93.1.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.93.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- ローカル承認通知 IPC ブリッジの起動時に Windows 名前付きパイプの生存確認を行い、競合インスタンスが重複リスナーを開かず `already_owned` を返すよう修正しました。
- ソケット切断時に待機タイマーを確実に解放し、高負荷な Windows 環境でもサブプロセスフックの非ブロッキング検証が安定して動作するよう調整しました。
### 注意
- 0.93.0 の Codex（`PermissionRequest`）および Antigravity（`PreToolUse`）向け読み取り専用承認通知機能をすべて引き継ぎます。既定では無効であり、許可・拒否の操作は常にデスクトップ側で行います。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-Setup-0.93.1.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.93.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.93.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.93.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.93.1/Token-Monitor-0.93.1-x86_64.AppImage)

</details>

</details>
