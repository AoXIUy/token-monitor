# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Active-turn auto-switch protection and race cleanup:** Defer 0%-remaining quota auto-switches while local Antigravity sessions are actively running (with a bounded timeout fallback) instead of terminating in-flight turns mid-execution, clear queued triggers on manual switches, and re-probe live RPC state on turn completion.
- **Pool quota freshness, family selection, and multi-client routing:** Require fresh verified pool quotas before auto-switching, prevent primary-scope fallback from cycling into accounts depleted in the triggered model family, probe concurrent local `app` / `cli` / `ide` RPC sources independently, support automatic ACP plugin routing and CLI credential sync, and retry post-hot-switch identity checks.
- **Safer post-switch task auto-resume and audit history:** Exclude user-canceled turns, `ask_question` / feedback-waiting prompts, and completed turns with trailing checkpoints from automatic `agentapi` resumption, limit manual switches to actively running turns isolated by target client, and persist bounded local auto-switch history across restarts.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-Setup-0.106.2.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.106.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.2-x86_64.AppImage` then run it.

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
- **活跃会话防误杀保护与状态机竞态清理：** 在本地 Antigravity 会话活跃运行期间延迟 0% 硬耗尽自动切号（带防卡死超时兜底），避免跨模型族任务或本地工具执行被中途强杀；手动切号时立即清理挂起的旧限流快照，并在轮次结束时优先重探实时本地 RPC 状态。
- **账号池配额新鲜度门控、家族选号与多客户端路由：** 自动切号前强制校验候选账号配额新鲜度并识别已过重置时间的恢复窗口，阻止主池模式下回退切入同模型族耗尽账号引发死循环；支持本地 `app` / `cli` / `ide` 多端并发探测、ACP 插件自动路由与 CLI 凭据联动同步，并为热切身份核验增加重试与自动重启升级。
- **中断对话自动续跑安全门控与历史持久化：** 自动续跑时排除用户主动取消、等待交互提问或审批（`ask_question`）及带尾部检查点的已完成对话，手动切号仅接续切号瞬间运行中的目标客户端对话，并在本地持久化自动切号历史记录。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-Setup-0.106.2.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.106.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.2-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.106.1...v0.106.2">v0.106.1...v0.106.2</a></summary>

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
- **活躍工作階段防誤殺保護與狀態機競態清理：** 在本機 Antigravity 工作階段活躍執行期間延後 0% 硬耗盡自動切號（附防卡死逾時保底），避免跨模型族任務或本機工具執行被中途強制終止；手動切號時立即清除掛起的舊限流快照，並在輪次結束時優先重探即時本機 RPC 狀態。
- **帳號池配額新鮮度門控、家族選號與多用戶端路由：** 自動切號前強制校驗候選帳號配額新鮮度並識別已過重設時間的恢復視窗，阻止主池模式下回退切入同模型族耗盡帳號引發死循環；支援本機 `app` / `cli` / `ide` 多端並行探測、ACP 外掛自動路由與 CLI 憑證聯動同步，並為熱切身分核驗增加重試與自動重啟升級。
- **中斷對話自動續跑安全門控與歷史持久化：** 自動續跑時排除使用者主動取消、等待互動提問或審批（`ask_question`）及附尾部檢查點的已完成對話，手動切號僅接續切號瞬間執行中的目標用戶端對話，並在本機持久化自動切號歷史紀錄。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-Setup-0.106.2.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.106.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **실행 중인 턴 보호 및 자동 전환 경합 정리:** 로컬 Antigravity 세션이 활발히 실행 중일 때는 0% 소진 자동 전환을 지연(타임아웃 폴백 포함)하여 도구 실행이나 다른 모델 작업이 중간에 강제 종료되지 않도록 보호하고, 수동 전환 시 대기 중인 이전 한도 스냅샷을 즉시 비우며 턴 종료 시 실시간 로컬 RPC 상태를 다시 확인합니다.
- **계정 풀 할당량 최신성 검증, 패밀리 선택 및 다중 클라이언트 라우팅:** 자동 전환 전 후보 계정 할당량의 최신성과 초기화된 리셋 시간을 검증하고, 기본 범위에서 동일 모델 패밀리가 소진된 계정으로 반복 전환되는 루프를 차단하며, 로컬 `app` / `cli` / `ide` 동시 프로빙, ACP 플러그인 자동 라우팅, CLI 자격 증명 동기화 및 핫스위치 검증 재시도를 지원합니다.
- **안전한 작업 자동 재개 및 전환 기록 보존:** 사용자가 직접 취소한 턴, `ask_question` 응답 대기 상태, 후행 체크포인트가 있는 완료 대화를 `agentapi` 자동 재개 대상에서 제외하고, 수동 전환은 대상 클라이언트의 실행 중인 대화만 이어가며 로컬 자동 전환 이력을 재시작 후에도 유지합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-Setup-0.106.2.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.106.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **実行中ターンの自動切替保護と競合状態の解消：** ローカルの Antigravity セッションが稼働中の場合は残量 0% 到達時の自動切替をターン終了まで待機（上限タイムアウト付き）して実行中のツールや別モデルタスクの強制終了を防ぎ、手動切替時に保留中の古い上限スナップショットを破棄してターン終了時に最新 RPC 状態を再確認するよう修正しました。
- **プール残量の鮮度検証・ファミリー選択・複数クライアントルーティング：** 自動切替前に候補アカウント残量の鮮度と経過済みリセット時刻を検証し、主要スコープで同一モデルファミリーが枯渇したアカウントへループ切替する不具合を防止するとともに、ローカル `app` / `cli` / `ide` の個別プローブ、ACP プラグイン自動ルーティング、CLI 認証情報同期、ホットスイッチ検証の再試行に対応しました。
- **安全な中断タスク自動再開と切替履歴の永続化：** ユーザーが手動停止したターン、`ask_question` などの応答待ち状態、末尾チェックポイント付きの完了済み会話を `agentapi` 自動再開の対象から除外し、手動切替時は対象クライアントで実行中の会話のみを引き継ぎ、自動切替履歴を再起動後も保持するよう改善しました。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-Setup-0.106.2.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.106.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.106.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.2/Token-Monitor-0.106.2-x86_64.AppImage)

</details>

</details>
