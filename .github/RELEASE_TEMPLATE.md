# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Session sorting:** Switch between most recent activity and highest token usage in the Sessions list.
- **Individual setting resets:** Click the reset arrow beside a changed setting to restore its default.
- **Local Antigravity quota toggle:** Turn off automatic detection on this device to stop reading local quota while saved OAuth accounts continue refreshing independently.
- **Edge Dock reveal trigger area:** Choose whether auto-hide Edge Dock reveals across the full dock span or only near the handle.
- **Zed Agent ChatGPT usage:** Bundled Tokscale 4.23.1 adds usage tracking for Zed Agent threads running on a ChatGPT subscription.

### Fixed
- **Antigravity Account Manager responsiveness:** Switched process discovery, keyring, credential files, state DB, and device profile I/O to non-blocking async operations with throttled batch-refresh updates and incremental card rendering.
- **New session totals:** Show zero tokens and zero in the selected currency while a newly opened session's first usage reading is pending.
- **Antigravity anonymous quota cleanup:** Remove the stale anonymous local quota row once the same local RPC source identifies the account again.
- **Edge Dock multi-display and card dismissal:** Keep an open auto-hide dock visible on slight pointer overshoot onto an adjacent display and dismiss detail cards when leaving the rail.
- **Plugin icons and macOS hibernation glass:** Show plugin-supplied icons in AI Tool Limits and keep macOS glass styling on main windows rebuilt after hibernation.
- **Pi session names:** Propagate renamed or cleared Pi session titles across date ranges on the next scan.
- **Kimi Code response speed:** Show response speed from recorded response timing when request duration is unavailable.
- **GPT-6.2 cost estimates:** Apply the long-context rate to the entire request for Astra and Sol when input exceeds 272,000 tokens.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-Setup-0.104.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.104.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.104.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.104.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.104.0-x86_64.AppImage` then run it.

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
- **会话排序：** 会话列表支持按最近活动或 Token 用量从高到低切换排序。
- **恢复单项设置：** 点击已修改设置旁的恢复箭头，即可将该项还原为默认值。
- **Antigravity 本机额度检测开关：** 可关闭“自动检测本机 Antigravity 账号”停止读取本机额度；已保存的 OAuth 账号继续独立刷新。
- **侧边栏触发区域设置：** 支持设置自动隐藏侧边栏在整条侧边栏范围或仅在拉手附近触发展开。
- **Zed Agent 用量统计：** 内置 Tokscale 4.23.1，支持统计通过 ChatGPT 订阅运行的 Zed Agent 会话用量。

### 修复
- **Antigravity 账号管理器异步化与界面优化：** 将进程探测、系统钥匙串、凭据文件、状态库与设备档案读写迁移为非阻塞异步 I/O，并为批量刷新增加状态节流与卡片增量渲染。
- **新会话待上报用量：** 在新会话收到首笔用量数据前，Token 数和费用均先显示为零。
- **Antigravity 匿名额度清理：** 同一本机 RPC 来源重新识别出账号邮箱后，自动移除旧的匿名额度条目。
- **双屏侧边栏与详情卡片收起：** 自动隐藏模式下鼠标短距离越过相邻屏幕边缘时保持侧边栏展开，离开侧边栏时及时关闭详情卡片。
- **设置中的插件图标与 macOS 休眠材质：** “AI 工具额度”展示插件提供的图标，并修复 macOS 休眠重建主窗口后的玻璃材质丢失。
- **Pi 会话名称同步：** 下次扫描时将修改或清除的 Pi 会话名称同步反映到各时间范围。
- **Kimi Code 响应速度：** 缺少请求总耗时时，仍依据会话记录中的响应耗时显示生成速度。
- **GPT-6.2 长上下文费用估算：** Astra 与 Sol 输入超过 272,000 Token 时，整次请求按长上下文费率计费。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-Setup-0.104.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.104.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.104.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.104.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.104.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.103.0...v0.104.0">v0.103.0...v0.104.0</a></summary>

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
- **工作階段排序：** 工作階段清單支援在最近活動與最高 Token 用量之間切換排序。
- **還原單項設定：** 點擊已變更設定旁的還原箭頭，即可將該項目恢復為預設值。
- **Antigravity 本機額度偵測開關：** 可關閉「自動偵測本機 Antigravity 帳戶」以停止讀取本機額度，已儲存的 OAuth 帳戶仍會獨立更新。
- **側邊欄觸發區域設定：** 可選擇自動隱藏側邊欄在整個側邊欄範圍或僅在拉柄附近觸發展開。
- **Zed Agent 用量統計：** 內建 Tokscale 4.23.1，支援統計透過 ChatGPT 訂閱執行的 Zed Agent 工作階段用量。

### 修復
- **Antigravity 帳戶管理器非同步化與介面最佳化：** 將程序偵測、系統鑰匙圈、憑證檔案、狀態庫與裝置檔案讀寫改為非阻塞非同步 I/O，並為批次更新加入狀態節流與卡片增量算繪。
- **新工作階段待上報用量：** 在新工作階段收到首筆用量資料前，Token 數與費用皆先顯示為零。
- **Antigravity 匿名額度清理：** 同一個本機 RPC 來源重新識別出帳戶電子郵件後，自動移除舊的匿名額度列。
- **多螢幕側邊欄與詳情卡片收合：** 自動隱藏模式下指標短距離越過相鄰螢幕邊緣時保持側邊欄展開，離開側邊欄時立即關閉詳情卡片。
- **設定中的外掛圖示與 macOS 休眠材質：** 「AI 工具額度」會顯示外掛提供的圖示，並保留 macOS 休眠重建主視窗後的玻璃材質。
- **Pi 工作階段名稱同步：** 下次掃描時將重新命名或清除的 Pi 工作階段名稱同步反映到各時間範圍。
- **Kimi Code 回應速度：** 缺少請求總耗時時，仍可依工作階段記錄的回應耗時顯示生成速度。
- **GPT-6.2 長上下文費用估算：** Astra 與 Sol 輸入超過 272,000 Token 時，整筆請求皆套用長上下文費率。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-Setup-0.104.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.104.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.104.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **세션 정렬:** 세션 목록에서 최근 활동순과 높은 토큰 사용량순을 전환할 수 있습니다.
- **개별 설정 초기화:** 변경된 설정 옆의 초기화 화살표를 클릭해 해당 항목을 기본값으로 되돌릴 수 있습니다.
- **로컬 Antigravity 할당량 감지 전환:** 이 기기에서 로컬 할당량 자동 감지를 끌 수 있으며, 저장된 OAuth 계정은 독립적으로 계속 새로고침됩니다.
- **가장자리 도크 표시 트리거 영역:** 자동 숨김 도크를 전체 도크 영역에서 열지 핸들 근처에서만 열지 선택할 수 있습니다.
- **Zed Agent ChatGPT 사용량:** 번들된 Tokscale 4.23.1로 ChatGPT 구독에서 실행되는 Zed Agent 스레드 사용량을 집계합니다.

### 수정
- **Antigravity 계정 관리자 응답성 개선:** 프로세스 탐색, 키링, 자격 증명 파일, 상태 DB 및 기기 프로필 I/O를 비동기 비차단 방식으로 전환하고 일괄 새로고침 상태 스로틀링과 증분 카드 렌더링을 적용했습니다.
- **새 세션 합계 표시:** 첫 사용량 데이터가 도착하기 전까지 새 세션의 토큰 수와 비용을 0으로 표시합니다.
- **Antigravity 익명 할당량 정리:** 동일한 로컬 RPC 소스에서 계정이 다시 식별되면 오래된 익명 할당량 행을 제거합니다.
- **다중 디스플레이 도크 및 카드 닫기:** 자동 숨김 도크에서 포인터가 인접 화면으로 살짝 넘어가도 도크를 유지하고, 레일을 벗어나면 세부 카드를 닫습니다.
- **설정의 플러그인 아이콘 및 macOS 절전 유리 효과:** AI 도구 한도에 플러그인 아이콘을 표시하고, macOS 절전 복구 후 다시 생성된 기본 창의 유리 스타일을 유지합니다.
- **Pi 세션 이름 동기화:** 이름을 바꾸거나 지운 Pi 세션 제목을 다음 스캔 시 모든 기간 범위에 반영합니다.
- **Kimi Code 응답 속도:** 요청 소요 시간이 없어도 세션에 기록된 응답 시간을 기준으로 속도를 표시합니다.
- **GPT-6.2 긴 컨텍스트 비용 추정:** Astra와 Sol 입력이 272,000토큰을 초과하면 전체 요청에 긴 컨텍스트 요율을 적용합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-Setup-0.104.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.104.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.104.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **セッションの並べ替え：** セッション一覧を最近のアクティビティ順とトークン使用量の多い順で切り替えられます。
- **設定項目ごとのリセット：** 変更した項目の横にあるリセット矢印から、その項目を既定値に戻せます。
- **Antigravity ローカル上限検出の切り替え：** この端末でのローカル上限の自動検出をオフにでき、保存済み OAuth アカウントは引き続き個別に更新されます。
- **エッジドックの表示トリガー範囲：** 自動で隠れるエッジドックをドック全体またはハンドル付近のみで表示するか選べます。
- **Zed Agent の ChatGPT 使用量：** 同梱の Tokscale 4.23.1 により、ChatGPT サブスクリプションで実行する Zed Agent スレッドの使用量を集計します。

### 修正
- **Antigravity アカウントマネージャーの応答性向上：** プロセス検出、キーリング、認証情報ファイル、状態 DB、デバイスプロファイルの I/O を非ブロッキング非同期処理へ移行し、一括更新のスロットリングとカード差分描画を導入しました。
- **新しいセッションの合計表示：** 最初の使用量データが届くまで、新しいセッションのトークン数と費用をゼロとして表示します。
- **Antigravity の匿名上限行の整理：** 同じローカル RPC ソースでアカウントが再び識別されたときに、古い匿名の上限行を削除します。
- **複数ディスプレイでのドック維持とカード終了：** 自動非表示モードでポインターが隣接画面に少しはみ出してもドックを閉じず、レールから離れた際に詳細カードを閉じます。
- **設定のプラグインアイコンと macOS 休止後のガラス表示：** 「AI ツール制限」にプラグイン提供のアイコンを表示し、macOS 休止後に再構築されたメインウィンドウのガラス外観を維持します。
- **Pi セッション名の同期：** 変更または削除された Pi セッション名が、次回スキャン時に各期間へ反映されます。
- **Kimi Code の応答速度：** リクエスト所要時間が取得できない場合でも、記録された応答時間から速度を表示します。
- **GPT-6.2 の長コンテキスト費用見積もり：** Astra と Sol の入力が 272,000 トークンを超えた場合、リクエスト全体に長コンテキスト料金を適用します。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-Setup-0.104.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.104.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.104.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.104.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.104.0/Token-Monitor-0.104.0-x86_64.AppImage)

</details>

</details>
