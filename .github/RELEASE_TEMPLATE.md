# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Git worktree grouping:** Linked git worktrees are automatically resolved to their parent repository via `.git` and `commondir`, grouping worktree sessions under the main repository row on the Projects page.
- **OpenClaw usage:** Tokscale 4.23.0 adds collection from OpenClaw SQLite transcript archives with deduplication across live and exported transcripts.
- **Account declaration type checking:** Adds JSDoc `AccountDeclaration` definitions and `@satisfies` across all provider declarations, verified via `npm run typecheck` in verify and CI.

### Improved
- **New API scoped tokens and error diagnostics:** Supports New API scoped and 30-day tokens, identifying expired legacy tokens (`ACCESS_TOKEN_LEGACY_RETIRED`) and missing scopes (`ACCESS_TOKEN_SCOPE_DENIED`). Tokens with only balance access can now be saved with an informational warning when period spending is unavailable.
- **Muse web quota recovery:** Accepts Next.js `static/immutable/chunks/` layouts and automatically retries stale server actions (400, 404, 409) with rediscovered action IDs.
- **Edge Dock animation continuity:** Retains running and waiting animation phases, hover glows, and session activity pulse effects across live updates without visual interruptions or flickering.

### Notes
- Synced [Javis603/token-monitor v0.93.1](https://github.com/Javis603/token-monitor/releases/tag/v0.93.1) at `55cd6bfb`. This fork includes online conversations, session output rates and read-only approval alerts for Android.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-Setup-0.95.1.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.95.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.95.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.95.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.95.1-x86_64.AppImage` then run it.

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
- **Git Worktree 项目合并：** 自动通过关联 worktree 的 `.git` 与 `commondir` 解析其父仓库，在“项目”页面中将所有 worktree 的会话统一汇总至主仓库行。
- **OpenClaw 用量支持：** 升级至 Tokscale 4.23.0，支持从 OpenClaw SQLite 会话归档中采集用量，并自动对实时会话与导出记录去重。
- **账号声明类型检查：** 为所有额度提供商账号声明添加 JSDoc `AccountDeclaration` 与 `@satisfies` 校验，并在 `verify` 与 CI 中通过 `npm run typecheck` 执行类型检查。

### 改进
- **New API 分权限令牌与错误诊断：** 适配 New API 分权限与 30 天有效期令牌，明确区分已废弃的旧令牌（`ACCESS_TOKEN_LEGACY_RETIRED`）与权限不足（`ACCESS_TOKEN_SCOPE_DENIED`）；仅有余额权限的令牌现可正常保存，并在缺少周期消费权限时给出清晰提示。
- **Muse Web 额度恢复：** 兼容 Next.js `static/immutable/chunks/` 静态分块路径，遇到过期的服务端动作（400、404、409）时自动重新发现动作 ID 并重试。
- **Edge Dock 动效连续性：** 在实时刷新过程中保留运行中与等待中的动画阶段、悬浮光晕与会话脉冲动效，避免界面跳变或闪烁。

### 说明
- 同步 [Javis603/token-monitor v0.93.1](https://github.com/Javis603/token-monitor/releases/tag/v0.93.1)（`55cd6bfb`）。本分支提供安卓在线对话、会话输出速率和只读审批提醒。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-Setup-0.95.1.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.95.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.95.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.95.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.95.1-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.95.0...v0.95.1">v0.95.0...v0.95.1</a></summary>

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
- **Git Worktree 專案合併：** 自動透過關聯 worktree 的 `.git` 與 `commondir` 解析其父儲存庫，在「專案」頁面中將所有 worktree 的工作階段統一彙總至主儲存庫列。
- **OpenClaw 用量支援：** 升級至 Tokscale 4.23.0，支援從 OpenClaw SQLite 工作階段封存中採集用量，並自動對即時工作階段與匯出紀錄去重。
- **帳號宣告型別檢查：** 為所有額度提供者帳號宣告加入 JSDoc `AccountDeclaration` 與 `@satisfies` 校驗，並在 `verify` 與 CI 中透過 `npm run typecheck` 執行型別檢查。

### 改進
- **New API 分權限權杖與錯誤診斷：** 適配 New API 分權限與 30 天有效期權杖，明確區分已廢棄的舊權杖（`ACCESS_TOKEN_LEGACY_RETIRED`）與權限不足（`ACCESS_TOKEN_SCOPE_DENIED`）；僅有餘額權限的權杖現可正常儲存，並在缺少週期消費權限時給出清楚提示。
- **Muse Web 額度恢復：** 相容 Next.js `static/immutable/chunks/` 靜態分塊路徑，遇到過期的伺服器動作（400、404、409）時自動重新探索動作 ID 並重試。
- **Edge Dock 動效連續性：** 在即時重新整理過程中保留執行中與等待中的動畫階段、懸浮光暈與工作階段脈衝動效，避免介面跳變或閃爍。

### 說明
- 同步 [Javis603/token-monitor v0.93.1](https://github.com/Javis603/token-monitor/releases/tag/v0.93.1)（`55cd6bfb`）。本分支提供 Android 線上對話、工作階段輸出速率和唯讀審批提醒。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-Setup-0.95.1.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.95.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.95.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **Git Worktree 프로젝트 그룹화:** 연결된 Git worktree의 `.git` 및 `commondir`을 통해 상위 저장소를 자동으로 확인하여 프로젝트 페이지에서 worktree 세션을 상위 저장소 행에 통합합니다.
- **OpenClaw 사용량 지원:** Tokscale 4.23.0으로 업데이트하여 OpenClaw SQLite 세션 아카이브 수집을 지원하고 실시간 및 내보낸 세션 간의 중복을 방지합니다.
- **계정 선언 타입 검사:** 모든 한도 제공자 계정 선언에 JSDoc `AccountDeclaration` 및 `@satisfies` 검증을 추가하고 `verify` 및 CI에서 `npm run typecheck`를 실행합니다.

### 개선
- **New API 스코프 토큰 및 오류 진단:** New API의 범위 지정 및 30일 만료 토큰을 지원하며 만료된 레거시 토큰(`ACCESS_TOKEN_LEGACY_RETIRED`)과 권한 부족(`ACCESS_TOKEN_SCOPE_DENIED`)을 명확히 구분합니다. 잔액 조회 권한만 있는 토큰도 저장할 수 있으며 기간별 지출 조회가 불가능할 때 안내 메시지를 표시합니다.
- **Muse Web 한도 복구:** Next.js `static/immutable/chunks/` 청크 경로를 지원하고 만료된 서버 액션(400, 404, 409) 발생 시 액션 ID를 자동으로 다시 검색하여 재시도합니다.
- **Edge Dock 애니메이션 연속성:** 실시간 업데이트 중에도 실행 중/대기 중 애니메이션 단계, 호버 글로우 및 세션 활동 펄스를 유지하여 깜빡임이나 끊김을 방지합니다.

### 참고
- [Javis603/token-monitor v0.93.1](https://github.com/Javis603/token-monitor/releases/tag/v0.93.1)의 `55cd6bfb`을 반영했습니다. 이 포크는 Android의 온라인 대화, 세션 출력 속도 및 읽기 전용 승인 알림을 제공합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-Setup-0.95.1.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.95.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.95.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **Git Worktree プロジェクトの統合:** リンクされた Git worktree の `.git` と `commondir` から親リポジトリを自動解決し、プロジェクトページで各 worktree のセッションを親リポジトリの行にまとめます。
- **OpenClaw 使用量のサポート:** Tokscale 4.23.0 にアップデートし、OpenClaw の SQLite 会話アーカイブからの収集に対応し、リアルタイムおよびエクスポート済みセッションの重複排除を行います。
- **アカウント宣言の型チェック:** すべての制限プロバイダーのアカウント宣言に JSDoc `AccountDeclaration` と `@satisfies` 検証を追加し、`verify` と CI で `npm run typecheck` を実行します。

### 改善
- **New API スコープ付きトークンとエラー診断:** New API のスコープ付きおよび 30 日期限トークンに対応し、期限切れレガシートークン（`ACCESS_TOKEN_LEGACY_RETIRED`）と権限不足（`ACCESS_TOKEN_SCOPE_DENIED`）を明確に区別します。残高のみの権限を持つトークンも保存可能となり、期間ごとの支出が取得できない場合の案内を表示します。
- **Muse Web 制限の回復:** Next.js の `static/immutable/chunks/` チャンク配置に対応し、失効したサーバーアクション（400, 404, 409）が発生した際にアクション ID を自動で再検出して再試行します。
- **Edge Dock アニメーションの継続性:** リアルタイム更新時にも実行中・待機中アニメーションのフェーズ、ホバー時の光彩、セッションアクティビティパルスを維持し、表示のちらつきやリセットを防ぎます。

### 注意
- [Javis603/token-monitor v0.93.1](https://github.com/Javis603/token-monitor/releases/tag/v0.93.1) の `55cd6bfb` を取り込みました。このフォークは Android のオンライン会話、セッション出力速度、読み取り専用の承認通知を提供します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-Setup-0.95.1.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.95.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.95.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.95.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.95.1/Token-Monitor-0.95.1-x86_64.AppImage)

</details>

</details>
