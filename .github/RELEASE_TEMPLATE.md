# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Packaged App Launch (`app.asar`):** Bundled `plugins/quota-alerts/evaluator.cjs` into `package.json -> build.files`, fixing the `Cannot find module '../../plugins/quota-alerts/evaluator.cjs'` main-process startup crash in packaged Windows and Linux builds (`0.98.1`).
- **Packaged OpenClaw Skill Provisioning:** Bundled `skills/openclaw-token-monitor/**/*` in `package.json -> build.files` and switched `installOpenClawSkill` to read/write copies so bundled `SKILL.md` and `scripts/query-token-monitor.mjs` extract cleanly out of Electron `app.asar`.
- **Packaging & Timer Regression Coverage:** Added automated checks confirming all relative runtime `require()` targets stay covered by `build.files` and stabilized debounce settlement polling in OpenClaw bridge and route tests.

### Notes
- **OpenClaw 0.98 Capabilities:** Includes real-time session completion, approval, quota, and service-status pushes, expanded `/api/query/*` & 17-tool MCP endpoints, and Desktop `local`-mode integration with optional `127.0.0.1` loopback HTTP/MCP bridge.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-Setup-0.98.2.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.98.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.98.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.98.2-x86_64.AppImage` then run it.

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
- **打包后应用启动崩溃（`app.asar`）：** 将 `plugins/quota-alerts/evaluator.cjs` 纳入 `package.json -> build.files`，修复 `0.98.1` 打包版（Windows / Linux AppImage / `.deb`）主进程启动时报错 `Cannot find module '../../plugins/quota-alerts/evaluator.cjs'` 的问题。
- **打包环境 OpenClaw 技能自动安装：** 将 `skills/openclaw-token-monitor/**/*` 纳入 `package.json -> build.files`，并在 `installOpenClawSkill` 中改用读写流式写入以兼容从 Electron `app.asar` 提取下发 `SKILL.md` 与 `scripts/query-token-monitor.mjs`。
- **打包完整性与定时器稳定性防线：** 新增自动校验测试确保所有 `src/` 运行时相对 `require()` 路径均被 `build.files` 覆盖，并加固 OpenClaw 桥接与路由测试的防抖等待轮询。

### 说明
- **包含 0.98 全部 OpenClaw 深度联动能力：** 涵盖会话结束/审批/额度/服务异常主动推送、`/api/query/*` 统一查询与 17 工具 MCP 扩展，以及桌面端 `local` 模式解锁和可选本机 `127.0.0.1` 回环桥接。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-Setup-0.98.2.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.98.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.98.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.98.2-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.98.1...v0.98.2">v0.98.1...v0.98.2</a></summary>

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
- **打包後應用程式啟動失敗（`app.asar`）：** 將 `plugins/quota-alerts/evaluator.cjs` 納入 `package.json -> build.files`，修復 `0.98.1` 打包版主行程啟動時拋出 `Cannot find module '../../plugins/quota-alerts/evaluator.cjs'` 的錯誤。
- **打包環境 OpenClaw 技能安裝：** 將 `skills/openclaw-token-monitor/**/*` 納入 `package.json -> build.files`，並在 `installOpenClawSkill` 改用讀寫寫入以穩定自 Electron `app.asar` 提取 `SKILL.md` 與 `scripts/query-token-monitor.mjs`。
- **打包覆蓋與計時器穩定性測試：** 新增檢查確保所有 `src/` 相對 `require()` 皆被 `build.files` 覆蓋，並強化 OpenClaw 橋接與路由測試的消抖輪詢等待。

### 說明
- **包含 0.98 完整 OpenClaw 深度整合：** 提供即時工作階段結束/審批/額度/服務異常主動推送、`/api/query/*` 統一查詢與 17 工具 MCP 擴展，以及桌面端 `local` 模式與可選 `127.0.0.1` 迴環橋接。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-Setup-0.98.2.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.98.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **패키지 앱 시작 오류 수정 (`app.asar`):** `package.json -> build.files`에 `plugins/quota-alerts/evaluator.cjs`를 포함하여 `0.98.1` 패키지 빌드 실행 시 메인 프로세스에서 발생하던 `Cannot find module '../../plugins/quota-alerts/evaluator.cjs'` 오류를 수정했습니다.
- **패키지 환경 OpenClaw 스킬 설치 수정:** `skills/openclaw-token-monitor/**/*`를 `build.files`에 추가하고 `installOpenClawSkill`이 Electron `app.asar`에서 `SKILL.md`와 `scripts/query-token-monitor.mjs`를 안전하게 복사하도록 개선했습니다.
- **패키징 검증 및 타이머 안정성 강화:** 모든 상대 `require()` 경로가 `build.files`에 포함되는지 확인하는 자동 회귀 테스트를 추가하고 OpenClaw 브리지/라우트 테스트의 디바운스 대기를 안정화했습니다.

### 참고
- **0.98 OpenClaw 통합 기능 포함:** 실시간 세션 완료·승인·할당량·서비스 장애 알림 푸시, `/api/query/*` 통합 조회 및 17개 MCP 도구 확장, 데스크톱 `local` 모드와 선택형 `127.0.0.1` 루프백 브리지를 포함합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-Setup-0.98.2.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.98.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **パッケージ版の起動エラー修正（`app.asar`）：** `package.json -> build.files` に `plugins/quota-alerts/evaluator.cjs` を追加し、`0.98.1` パッケージ版のメインプロセス起動時に発生していた `Cannot find module '../../plugins/quota-alerts/evaluator.cjs'` エラーを修正しました。
- **パッケージ版での OpenClaw スキル導入対応：** `skills/openclaw-token-monitor/**/*` を `build.files` に含め、`installOpenClawSkill` が Electron `app.asar` から `SKILL.md` と `scripts/query-token-monitor.mjs` を確実に展開できるよう読み書きコピーへ変更しました。
- **パッケージ検証とタイマー安定性の強化：** `src/` 配下の全相対 `require()` が `build.files` に含まれることを検証する回帰テストを追加し、OpenClaw ブリッジ／ルートテストのデバウンス待機を安定化しました。

### 注意
- **0.98 の OpenClaw 連携機能を収録：** セッション完了・承認・クォータ・サービス障害のリアルタイム通知、`/api/query/*` 統合クエリと 17 種の MCP ツール、デスクトップ `local` モードおよび任意の `127.0.0.1` ループバックブリッジを引き続き提供します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-Setup-0.98.2.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.98.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.98.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.98.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.98.2/Token-Monitor-0.98.2-x86_64.AppImage)

</details>

</details>
