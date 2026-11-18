# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **OpenClaw Quota Alert Account Labels:** Preserved non-sensitive `accountLabel`, `profileName`, `accountName`, `planLabel`, and `label` fields in `extractQuotaRowsFromStats` and `evaluateQuotaAlerts` (`src/electron/openclawBridge.js`) so quota low/recovery notifications display human-readable account labels (such as `Plus`, `Pro`, or workspace names) instead of raw `sha256:...` keys.
- **Compact Fingerprint Fallback (`safeAccountDisplayLabel`):** Updated `safeAccountDisplayLabel` in `src/shared/aiReportAnalyzer.js` to shorten opaque `sha256:<hex>` identifiers to a 6-character `#xxxxxx` fingerprint when no descriptive label is available, while continuing to scrub emails, URLs, and credentials.

### Notes
- **OpenClaw 0.98 Capabilities:** Includes real-time session completion, approval, quota, and service-status pushes, expanded `/api/query/*` & 17-tool MCP endpoints, and Desktop `local`-mode integration with optional `127.0.0.1` loopback HTTP/MCP bridge.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-Setup-0.98.3.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.98.3-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.3-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.98.3-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.98.3-x86_64.AppImage` then run it.

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
- **OpenClaw 额度通知账号显示：** 在 `extractQuotaRowsFromStats` 与 `evaluateQuotaAlerts`（`src/electron/openclawBridge.js`）中保留非敏感的 `accountLabel`、`profileName`、`accountName`、`planLabel`、`label` 字段并附带 `accountDisplay`，使额度预警与恢复通知显示人类可读的账号标签（如 `Plus`、`Pro` 或工作区名称），不再直接输出原始 `sha256:...` 哈希。
- **匿名指纹简写回退（`safeAccountDisplayLabel`）：** 在 `src/shared/aiReportAnalyzer.js` 中将缺少可读标签时的 `sha256:<hex>` 账号标识自动缩短为 6 位 `#xxxxxx` 指纹格式，同时保持邮箱、URL 与凭据脱敏逻辑不变。

### 说明
- **包含 0.98 全部 OpenClaw 深度联动能力：** 涵盖会话结束/审批/额度/服务异常主动推送、`/api/query/*` 统一查询与 17 工具 MCP 扩展，以及桌面端 `local` 模式解锁和可选本机 `127.0.0.1` 回环桥接。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-Setup-0.98.3.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.98.3-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.3-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.98.3-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.98.3-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.98.2...v0.98.3">v0.98.2...v0.98.3</a></summary>

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
- **OpenClaw 額度通知帳號顯示：** 在 `extractQuotaRowsFromStats` 與 `evaluateQuotaAlerts`（`src/electron/openclawBridge.js`）保留非敏感的 `accountLabel`、`profileName`、`accountName`、`planLabel`、`label` 欄位並附加 `accountDisplay`，讓額度預警與恢復通知顯示人類可讀的帳號標籤（如 `Plus`、`Pro` 或工作區名稱），不再直接輸出原始 `sha256:...` 雜湊。
- **匿名指紋簡寫回退（`safeAccountDisplayLabel`）：** 在 `src/shared/aiReportAnalyzer.js` 中將缺少可讀標籤時的 `sha256:<hex>` 帳號識別碼縮短為 6 位 `#xxxxxx` 指紋格式，同時維持信箱、URL 與憑證遮罩不變。

### 說明
- **包含 0.98 完整 OpenClaw 深度整合：** 提供即時工作階段結束/審批/額度/服務異常主動推送、`/api/query/*` 統一查詢與 17 工具 MCP 擴展，以及桌面端 `local` 模式與可選 `127.0.0.1` 迴環橋接。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-Setup-0.98.3.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.98.3-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.3-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **OpenClaw 할당량 알림 계정 표시 수정:** `extractQuotaRowsFromStats` 및 `evaluateQuotaAlerts`(`src/electron/openclawBridge.js`)에서 민감하지 않은 `accountLabel`, `profileName`, `accountName`, `planLabel`, `label` 필드와 `accountDisplay`를 보존해 할당량 부족·복구 알림에 원시 `sha256:...` 해시 대신 읽기 쉬운 계정 라벨(`Plus`, `Pro`, 워크스페이스 이름 등)이 표시되도록 했습니다.
- **짧은 지문 폴백(`safeAccountDisplayLabel`):** `src/shared/aiReportAnalyzer.js`에서 설명 라벨이 없을 때 `sha256:<hex>` 식별자를 6자리 `#xxxxxx` 지문으로 축약하며, 이메일·URL·자격 증명 마스킹을 그대로 유지합니다.

### 참고
- **0.98 OpenClaw 통합 기능 포함:** 실시간 세션 완료·승인·할당량·서비스 장애 알림 푸시, `/api/query/*` 통합 조회 및 17개 MCP 도구 확장, 데스크톱 `local` 모드와 선택형 `127.0.0.1` 루프백 브리지를 포함합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-Setup-0.98.3.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.98.3-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.3-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **OpenClaw クォータ通知のアカウント表示修正：** `extractQuotaRowsFromStats` および `evaluateQuotaAlerts`（`src/electron/openclawBridge.js`）で非機密の `accountLabel`・`profileName`・`accountName`・`planLabel`・`label` と `accountDisplay` を保持し、クォータ警告／復旧通知に生 `sha256:...` ハッシュではなく可読アカウントラベル（`Plus`、`Pro`、ワークスペース名など）を表示するようにしました。
- **短縮フィンガープリントへのフォールバック（`safeAccountDisplayLabel`）：** `src/shared/aiReportAnalyzer.js` で可読ラベルがない場合に `sha256:<hex>` 識別子を 6 桁の `#xxxxxx` フィンガープリントへ短縮表示し、メール・URL・認証情報のマスク処理を維持します。

### 注意
- **0.98 の OpenClaw 連携機能を収録：** セッション完了・承認・クォータ・サービス障害のリアルタイム通知、`/api/query/*` 統合クエリと 17 種の MCP ツール、デスクトップ `local` モードおよび任意の `127.0.0.1` ループバックブリッジを引き続き提供します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-Setup-0.98.3.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.98.3.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.98.3-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.3-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.3/Token-Monitor-0.98.3-x86_64.AppImage)

</details>

</details>
