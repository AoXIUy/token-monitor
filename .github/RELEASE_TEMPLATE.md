# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Android conversations:** Read Antigravity and Codex conversation pages from an online source only when requested.
- **Private by default:** Enable TOKEN_MONITOR_SESSION_CONVERSATIONS separately on the Node Hub and resident source. Bodies are never persisted by the Hub.
### Changed
- Desktop updates use this fork. Release builds require Node 22/24 verification and retain existing signing checks.
<!-- app-update-notes:en:end -->
## Download

- **macOS Apple Silicon** — [Token-Monitor-0.91.0-arm64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-arm64.dmg)
- **macOS Intel** — [Token-Monitor-0.91.0-x64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-x64.dmg)
- **Windows Installer** — [Token-Monitor-Setup-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-Setup-0.91.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.exe) (no install required)
- **Linux x64** — [Token-Monitor-0.91.0.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**macOS:** the app is Developer ID-signed and notarized by Apple. Open the `.dmg`, then drag Token Monitor to Applications.

**Windows:** both executables are signed ([how to verify](https://github.com/AoXIUy/token-monitor/blob/main/docs/code-signing.md#verify-a-download)).

**Linux:** mark the AppImage executable, then run it:

```bash
chmod +x Token-Monitor-*.AppImage
./Token-Monitor-*.AppImage
```

### Other notes

Other platforms are not pre-built — run from source per the [README](https://github.com/AoXIUy/token-monitor#readme). The macOS `.zip` is the same app repackaged; ignore it unless you specifically need it.

### tokscale dependency

Tokscale is bundled with this app and updated through Token Monitor releases. See **Settings → Advanced → Tokscale** for the version and fork build identifier. Tokscale is MIT, open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 新增
- **在线对话：** 配合 Android 1.8.0，按需查看 Antigravity / Codex 的提问、回复、上下文与工具记录。
- **默认关闭：** Hub 与来源端分别启用 TOKEN_MONITOR_SESSION_CONVERSATIONS，正文不进入 Hub 持久化。
### 变更
- 桌面更新使用此 fork，发布前运行 Node 22/24 校验并保留原有签名验证。
<!-- app-update-notes:zh:end -->

## 下载

- **macOS Apple Silicon** — [Token-Monitor-0.91.0-arm64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-arm64.dmg)
- **macOS Intel** — [Token-Monitor-0.91.0-x64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-x64.dmg)
- **Windows 安装版** — [Token-Monitor-Setup-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-Setup-0.91.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.exe)（免安装）
- **Linux x64** — [Token-Monitor-0.91.0.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**macOS：** 应用已使用 Developer ID 签名并通过 Apple 公证。打开 `.dmg`，然后把 Token Monitor 拖到 Applications。

**Windows：** 两个可执行文件均已签名（[查看验证方法](https://github.com/AoXIUy/token-monitor/blob/main/docs/code-signing.md#verify-a-download)）。

**Linux：** 先给 AppImage 执行权限，然后运行：

```bash
chmod +x Token-Monitor-*.AppImage
./Token-Monitor-*.AppImage
```

### 其他说明

其他平台暂不提供预构建版本，请参考 [README](https://github.com/AoXIUy/token-monitor#readme) 从源码运行。macOS 的 `.zip` 只是同一个 app 的重新打包版本，除非你明确需要，否则可以忽略。

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.90.0...v0.91.0">v0.90.0...v0.91.0</a></summary>

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
- **線上對話：** 配合 Android 1.8.0，按需查看 Antigravity / Codex 對話與上下文。
- **預設關閉：** Hub 與來源端分別啟用 TOKEN_MONITOR_SESSION_CONVERSATIONS，Hub 不儲存正文。
### 變更
- 桌面更新使用此 fork，發布前執行 Node 22/24 驗證並保留既有簽章檢查。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **macOS Apple Silicon** — [Token-Monitor-0.91.0-arm64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-arm64.dmg)
- **macOS Intel** — [Token-Monitor-0.91.0-x64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-x64.dmg)
- **Windows 安裝版** — [Token-Monitor-Setup-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-Setup-0.91.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.exe)（免安裝）
- **Linux x64** — [Token-Monitor-0.91.0.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **Android 대화:** 온라인 기기의 Antigravity / Codex 대화와 문맥을 요청할 때만 읽습니다.
- **기본 비활성:** Node Hub와 수집기에서 TOKEN_MONITOR_SESSION_CONVERSATIONS를 각각 설정합니다. Hub는 본문을 저장하지 않습니다.
### 변경
- 이 fork에서 업데이트하며, 배포 전에 Node 22/24 검증과 기존 서명 검사를 수행합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **macOS Apple Silicon** — [Token-Monitor-0.91.0-arm64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-arm64.dmg)
- **macOS Intel** — [Token-Monitor-0.91.0-x64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-x64.dmg)
- **Windows 설치 버전** — [Token-Monitor-Setup-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-Setup-0.91.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.exe) (설치 필요 없음)
- **Linux x64** — [Token-Monitor-0.91.0.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **Android の会話表示：** オンライン端末の Antigravity / Codex の会話とコンテキストを要求時のみ読み取ります。
- **初期状態は無効：** Node Hub と収集端で TOKEN_MONITOR_SESSION_CONVERSATIONS を個別に設定します。Hub は本文を保存しません。
### 変更
- この fork を更新元とし、公開前に Node 22/24 の検証と既存の署名チェックを実行します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **macOS Apple Silicon** — [Token-Monitor-0.91.0-arm64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-arm64.dmg)
- **macOS Intel** — [Token-Monitor-0.91.0-x64.dmg](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0-x64.dmg)
- **Windows インストーラー** — [Token-Monitor-Setup-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-Setup-0.91.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.91.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.exe)（インストール不要）
- **Linux x64** — [Token-Monitor-0.91.0.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.91.0/Token-Monitor-0.91.0.AppImage)

</details>

</details>
