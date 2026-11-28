# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Active model quota-pool scoping for Antigravity auto-switch:** Detect the model currently used by active Antigravity conversations (via read-only conversation summaries, transcript tails, and `antigravity_state.pbtxt` paired with the local RPC model catalog) so running Gemini models no longer triggers auto-switching when an account's Claude/GPT pool is at 0%, while exhaustion in the actively used pool still triggers and prioritizes replacements for that pool.
- **Pre-switch stale RPC snapshot protection and safer acknowledgment pruning:** Ignore cached local RPC rows whose `updatedAt` predates the latest completed account switch so cross-provider `LimitsRuntime` refreshes cannot wipe manual-switch acknowledgments or replay an old exhausted account, and prune acknowledged windows only after observing explicit recovery rather than transient omission.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-Setup-0.107.1.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.107.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.107.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.107.1-x86_64.AppImage` then run it.

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
- **Antigravity 自动切号按当前对话模型额度池精准过滤：** 通过只读检测当前活跃 Antigravity 对话的尾部模型记录与界面选定模型（结合本地 RPC 模型目录映射），使用 Gemini 系列模型时即使当前账号的 Claude/GPT 池为 0% 也不再误触发自动切号；仅当正在使用的额度池达到阈值时才触发切号并优先选择该池余量更高的账号。
- **切号前旧 RPC 缓存行隔离与手动确认修剪加固：** 自动切号与手动确认核销现在会直接忽略 `updatedAt` 早于最近一次切号完成时间的旧缓存行，彻底解决其他服务商（如 Codex）刷新推送全量快照时意外清空手动切号确认或重放旧限额账号的问题，并确保仅在明确观测到窗口恢复后才移除已确认标记。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-Setup-0.107.1.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.107.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.107.1-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.107.1-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.107.0...v0.107.1">v0.107.0...v0.107.1</a></summary>

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
- **Antigravity 自動切換依目前對話模型額度池精準過濾：** 透過唯讀偵測目前活躍 Antigravity 對話的尾部模型紀錄與介面選定模型（結合本機 RPC 模型目錄對應），使用 Gemini 系列模型時即使目前帳號的 Claude/GPT 池為 0% 也不再誤觸發自動切換；僅當正在使用的額度池達到門檻時才觸發切換並優先挑選該池餘額較高的帳號。
- **切換前舊 RPC 快取列隔離與手動確認修剪強化：** 自動切換與手動確認核銷現在會直接略過 `updatedAt` 早於最近一次切換完成時間的舊快取列，徹底解決其他服務商（如 Codex）重新整理推送完整快照時意外清空手動切換確認或重播舊限額帳號的問題，並確保僅在明確觀測到視窗恢復後才移除已確認標記。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-Setup-0.107.1.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.107.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **활성 대화 모델 할당량 풀 기준의 Antigravity 자동 전환 필터링:** 실행 중인 Antigravity 대화의 요약·트랜스크립트 끝부분과 `antigravity_state.pbtxt`(로컬 RPC 모델 카탈로그와 연계)를 읽기 전용으로 감지해, Gemini 모델을 사용 중일 때는 계정의 Claude/GPT 풀이 0%여도 자동 전환이 오작동하지 않으며 실제 사용 중인 풀이 소진될 때만 해당 풀 잔량이 높은 계정으로 전환합니다.
- **전환 이전 구버전 RPC 스냅샷 차단 및 수동 확인 정리 강화:** 최근 완료된 계정 전환 시각보다 이전의 `updatedAt`을 가진 캐시 RPC 행을 무시해 다른 공급자(예: Codex) 새로고침 시 전체 스냅샷 재발행으로 수동 전환 확인 상태가 지워지거나 이전 소진 계정이 재트리거되는 문제를 방지하고, 일시 누락이 아닌 명확한 복구가 관측된 경우에만 확인된 창을 제거합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-Setup-0.107.1.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.107.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **Antigravity 自動切替のアクティブモデル別クォータプール絞り込み：** 実行中の Antigravity 会話サマリー・トランスクリプト末尾および `antigravity_state.pbtxt`（ローカル RPC のモデルカタログと照合）を読み取り専用で検出し、Gemini 系モデル実行中はアカウントの Claude/GPT プールが 0% でも誤って自動切替されないようにし、実際に使用中のプールが枯渇した際のみそのプール残量が多いアカウントへ切り替えます。
- **切替前の古い RPC スナップショット除外と手動確認クリアの堅牢化：** 直近のアカウント切替完了時刻より古い `updatedAt` を持つキャッシュ RPC 行を無視することで、他プロバイダー（Codex など）更新時の全量再配信による手動切替確認の消失や旧枯渇アカウントの再発火を防ぎ、一時的な欠落ではなく明確な回復を観測した場合のみ確認済みウィンドウを解除します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-Setup-0.107.1.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.107.1.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.107.1-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.1-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.1/Token-Monitor-0.107.1-x86_64.AppImage)

</details>

</details>
