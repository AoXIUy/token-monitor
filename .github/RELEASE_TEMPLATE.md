# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Antigravity Account Manager sorting, filter counts, and auto-switch history:** Add pool order, remaining quota, plan tier, email, and recently updated sorting, live filter chip counts, available and low-quota summary counters, an empty-filter reset button, and a recent auto-switch history list inside the auto-switch popover.
- **Batch controls, lightweight live countdowns, and import feedback:** Add selection counts, clear-selection and export-selected labels, indeterminate select-all state, visibility-aware DOM updates for reset countdowns and relative ages without rebuilding account cards, popover toasts with scrollable popovers, and import busy guards with inline status messages.

### Fixed
- **Manual switch-back auto-switch loop:** Acknowledge already-exhausted local quota windows in memory after manually switching to an account in Antigravity Account Manager so returning to a Claude-exhausted account to use remaining Gemini quota no longer triggers an immediate re-switch, while newly exhausted windows or windows that recover and exhaust again still trigger normally.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-Setup-0.107.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.107.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.107.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.107.0-x86_64.AppImage` then run it.

### Other notes

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale is bundled with this app and updated through Token Monitor releases. See **Settings → General → Advanced → Tokscale** for the version and fork build identifier. Tokscale is MIT, open-source: https://github.com/junhoyeo/tokscale

</details>

---

# 中文

## 更新内容

<!-- app-update-notes:zh:start -->
### 新增
- **Antigravity 账号管理排序、筛选计数与自动切号历史：** 新增按默认顺序、剩余额度、订阅等级、邮箱与最近更新排序，在筛选标签上展示实时数量、摘要栏展示可用/额度偏低计数与空结果清除筛选按钮，并在自动切号浮层内展示最近自动切换记录。
- **批量选择体验、轻量实时倒计时与导入状态反馈：** 新增已选数量标签、清除选择与导出所选文案及全选半选态，改为按页面可见性轻量刷新重置倒计时与相对更新时间（无需重建卡片 DOM），升级浮层 Toast 与可滚动浮层，并为导入弹窗增加并发操作锁定与行内状态提示。

### 修复
- **手动切回限额账号后重复自动切号：** 在 Antigravity 账号管理器中手动切换到指定账号后，首次观测到的已耗尽本地配额窗口会在内存中标记为已确认，切回 Claude 已限额账号继续使用 Gemini 额度时不再立刻触发自动切号；仅当其他窗口新耗尽，或已确认窗口恢复后再次耗尽时才会重新触发。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-Setup-0.107.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.107.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.107.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.107.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.106.4...v0.107.0">v0.106.4...v0.107.0</a></summary>

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
- **Antigravity 帳號管理排序、篩選計數與自動切換紀錄：** 新增依預設順序、剩餘額度、訂閱等級、電子郵件與最近更新排序，在篩選標籤顯示即時數量、摘要列顯示可用／額度偏低計數與空白結果清除篩選按鈕，並於自動切換浮層顯示最近自動切換紀錄。
- **批次選取體驗、輕量即時倒數與匯入狀態回饋：** 新增已選數量標籤、清除選取與匯出所選文案及全選半選狀態，改為依頁面可見性輕量更新重置倒數與相對時間（無須重建卡片 DOM），升級浮層 Toast 與可捲動浮層，並為匯入視窗加入並行鎖定與行內狀態提示。

### 修復
- **手動切回限額帳號後重複自動切換：** 在 Antigravity 帳號管理器中手動切換至指定帳號後，首次觀測到的已耗盡本機配額視窗會在記憶體中標記為已確認，切回 Claude 已限額帳號繼續使用 Gemini 額度時不再立即觸發自動切換；僅當其他視窗新耗盡，或已確認視窗恢復後再次耗盡時才會重新觸發。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-Setup-0.107.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.107.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **Antigravity 계정 관리 정렬, 필터 개수 및 자동 전환 기록:** 기본 순서, 남은 할당량, 구독 등급, 이메일, 최근 업데이트 기준 정렬을 추가하고 필터 칩 실시간 개수, 사용 가능/할당량 부족 요약 카운트, 필터 초기화 버튼, 자동 전환 팝오버 내 최근 전환 기록 목록을 제공합니다.
- **일괄 선택 제어, 경량 실시간 카운트다운 및 가져오기 피드백:** 선택 개수 배지, 선택 해제 및 선택 내보내기 문구와 전체 선택 중간 상태를 추가하고, 카드 DOM을 다시 생성하지 않고 가시성 기반으로 초기화 카운트다운 및 상대 시간을 갱신하며, 팝오버 토스트·스크롤 가능한 팝오버·가져오기 중복 실행 방지 및 인라인 상태 표시를 지원합니다.

### 수정
- **한도 도달 계정으로 수동 전환 후 반복 자동 전환 문제:** Antigravity 계정 관리자에서 특정 계정으로 수동 전환하면 첫 관측 시 이미 소진된 로컬 할당량 창을 메모리에서 확인됨으로 표시해, Claude가 소진된 계정으로 돌아가 남은 Gemini 할당량을 사용할 때 즉시 다시 전환되지 않도록 수정했습니다. 다른 창이 새로 소진되거나 확인된 창이 복구된 뒤 다시 소진되면 정상적으로 다시 트리거됩니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-Setup-0.107.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.107.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **Antigravity アカウント管理の並び替え・フィルター件数・自動切替履歴：** デフォルト順・残量順・プラン順・メール順・更新日時順の並び替え、フィルターチップのリアルタイム件数、利用可能／残量少サマリー、フィルター解除ボタン、および自動切替ポップオーバー内の直近切替履歴リストを追加しました。
- **一括選択操作・軽量リアルタイムカウントダウン・インポート状態表示：** 選択件数、選択解除／選択項目のみエクスポート表示、全選択の中間状態を追加し、カード DOM を再構築せず可視状態に応じてリセットカウントダウンと相対時刻を軽量更新するとともに、ポップオーバー Toast・スクロール対応ポップオーバー・インポート操作の重複防止とインライン状態表示に対応しました。

### 修正
- **上限到達アカウントへ手動切替後の繰り返し自動切替：** Antigravity アカウント管理で任意のアカウントへ手動切替した際、初回観測時に既に枯渇しているローカルクォータウィンドウをメモリ上で確認済みとして扱い、Claude 上限到達アカウントへ戻して残りの Gemini クォータを使用する際に即座に再切替されないよう修正しました。別のウィンドウが新たに枯渇した場合や、確認済みウィンドウが回復後に再び枯渇した場合は通常どおり自動で切り替わります。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-Setup-0.107.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.107.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.107.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.107.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.107.0/Token-Monitor-0.107.0-x86_64.AppImage)

</details>

</details>
