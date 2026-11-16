# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Desktop Third-Party AI Save & Run Flow:** Fixed renderer form clobbering before save/analyze, Host `settings:push` ordering, secret-clear persistence, Windows proxy/system-CA routing (`electronLimitsFetch()`), and reasoning-model (`deepseek-flash`) `maxTokens` exhaustion (`4096` default + retry + `ai_token_limit` diagnostics).
- **Desktop Integration Controls & Validation:** Unified enable toggle switches, added pre-save URL/model validation, added one-click Host Hub activation in `local` mode, and localized integration error messages across all bundled languages.

### Added
- **OpenClaw WeChat Direct QR Login:** Added zero-dependency SVG QR rendering and `@tencent-weixin/openclaw-weixin` iLink QR onboarding (`wait`, `scaned`, `need_verifycode`, `confirmed`) in Desktop Settings and Main Hub (`/api/integrations/openclaw/*`), automatically persisting WeChat bot credentials, setting the `:18789/hooks/agent` endpoint and `ilink_user_id` target, and provisioning local OpenClaw hooks/skill when present.

### Notes
- Includes desktop third-party AI analysis fixes and one-click WeChat QR pairing for OpenClaw alongside online conversations, session output rates, approval alerts, and usage/project reports.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-Setup-0.97.2.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.97.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.97.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.97.2-x86_64.AppImage` then run it.

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
- **桌面端第三方 AI 保存与运行修复：** 修复点击保存/分析前表单被重置、Host 模式 `settings:push` 时序倒挂、清除密钥重启复活、Windows 代理/系统根证书未接入 `electronLimitsFetch()`，以及 `deepseek-flash` 等推理模型输出预算耗尽问题（默认 `maxTokens: 4096` 并支持自动重试与 `ai_token_limit` 提示）。
- **桌面端集成开关与校验：** 统一启用开关样式，增加保存前 URL/模型校验与 `local` 模式一键启用主 Hub 按钮，并补齐各语言 `ai_*` / `openclaw_*` / `not_found` 错误提示。

### 新增
- **OpenClaw 微信直接扫码接入：** 内置纯 JS SVG 二维码与 `@tencent-weixin/openclaw-weixin` iLink 扫码登录流程（等待扫码、确认授权、验证码校验、自动绑定），扫码后自动保存微信凭证、回填 `:18789/hooks/agent` 与 `ilink_user_id` 目标，并支持一键配置本机 OpenClaw Hooks 与技能。

### 说明
- 本版本修复桌面端第三方 AI 分析保存与执行问题并新增 OpenClaw 微信扫码接入，同时持续提供安卓在线对话、会话输出速率、只读审批提醒与周期报告 / MCP 分析。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-Setup-0.97.2.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.97.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.97.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.97.2-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.97.0...v0.97.2">v0.97.0...v0.97.2</a></summary>

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
- **桌面端第三方 AI 儲存與執行修復：** 修復儲存/分析前表單被重設、Host 模式 `settings:push` 時序問題、清除金鑰重啟復原、Windows 代理/系統憑證未接入 `electronLimitsFetch()`，以及 `deepseek-flash` 等推理模型輸出預算耗盡問題（預設 `maxTokens: 4096` 與自動重試）。
- **桌面端整合開關與驗證：** 統一啟用開關樣式，新增儲存前 URL/模型驗證與 `local` 模式一鍵啟用主 Hub 按鈕，並補齊各語系錯誤提示。

### 新增
- **OpenClaw 微信直接掃碼整合：** 內建純 JS SVG QR 碼與 `@tencent-weixin/openclaw-weixin` iLink 掃碼登入流程，掃碼後自動保存憑證、回填 `:18789/hooks/agent` 與 `ilink_user_id` 目標，並支援一鍵設定本機 OpenClaw Hooks 與技能。

### 說明
- 此版本修復桌面端第三方 AI 分析儲存與執行問題並新增 OpenClaw 微信掃碼整合，持續提供 Android 線上對話、工作階段輸出速率、唯讀審批提醒與週期報告 / MCP 分析。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-Setup-0.97.2.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.97.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **데스크톱 서드파티 AI 저장 및 실행 수정:** 저장/분석 전 입력값 초기화, Host 모드 `settings:push` 순서 역전, 키 삭제 후 재시작 복원, Windows 프록시·시스템 CA(`electronLimitsFetch()`) 누락 및 `deepseek-flash` 추론 모델의 `maxTokens` 소진 문제를 수정했습니다(`4096` 기본값 및 자동 재시도).
- **데스크톱 연동 토글 및 유효성 검사:** 활성화 토글 스타일을 통일하고 저장 전 URL·모델 검증, `local` 모드 원클릭 호스트 Hub 활성화 및 다국어 오류 안내를 추가했습니다.

### 추가
- **OpenClaw 위챗 QR 코드 직접 연동:** 무의존성 SVG QR 생성과 `@tencent-weixin/openclaw-weixin` iLink QR 로그인을 추가하여 스캔 후 인증 정보 저장, `:18789/hooks/agent` 및 `ilink_user_id` 자동 채움과 로컬 Hooks/스킬 구성을 지원합니다.

### 참고
- 이 릴리스는 데스크톱 서드파티 AI 분석 수정과 OpenClaw 위챗 QR 연동을 포함하며 Android 온라인 대화, 세션 출력 속도, 읽기 전용 승인 알림 및 보고서/MCP 기능을 계속 제공합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-Setup-0.97.2.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.97.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **デスクトップ版サードパーティ AI 保存・実行の修正:** 保存・分析前のフォーム初期化、Host モード `settings:push` の順序不整合、キー削除後の再起動時復元、Windows プロキシ・システム CA（`electronLimitsFetch()`）未経由、および `deepseek-flash` 等の推論モデルの出力上限枯渇を修正しました（既定 `maxTokens: 4096` と自動リトライ）。
- **デスクトップ連携スイッチと検証:** 有効化トグルの統一、保存前 URL・モデル検証、`local` モードからのワンクリック Host Hub 有効化、全言語エラーメッセージを追加しました。

### 追加
- **OpenClaw WeChat QR コード直接連携:** 依存なしの SVG QR 生成と `@tencent-weixin/openclaw-weixin` iLink QR ログインを追加し、スキャン後に認証情報の保存、`:18789/hooks/agent` と `ilink_user_id` の自動設定、ローカル Hooks・スキル構成を行えます。

### 注意
- 本リリースにはデスクトップ版サードパーティ AI 分析の修正と OpenClaw WeChat QR 連携に加え、Android 向けオンライン会話、セッション出力速度、承認通知、レポート／MCP 分析が含まれます。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-Setup-0.97.2.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.97.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.97.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.97.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.97.2/Token-Monitor-0.97.2-x86_64.AppImage)

</details>

</details>
