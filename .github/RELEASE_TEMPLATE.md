# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Antigravity Manager post-switch task auto-resume:** Detect Antigravity conversations interrupted by quota limits or switch restarts and automatically send a configurable continuation message via `agentapi` once the switched language server comes online.
- **Antigravity turn status and T3 Code ACP live activity:** See when a turn starts and finishes in Antigravity Desktop and CLI; in T3 Code, active Antigravity ACP sessions stay marked as running between token updates and appear before first tokens are recorded.
- **Kiro sessions in T3 Code:** Group related runs and delegated sessions under their T3 Code threads.

### Changed
- **Local Codex Work settings:** Rename the experimental Dots switches to “Collect local Codex Work usage” and “Show local Codex Work usage” for local Work tasks without a session log.

### Improved
- **Antigravity Manager grouped quota cards and model hints:** Render quota buckets grouped by family with included model hints, explicit `5h` and weekly window badges, disabled bucket indicators, 5h-limited weekly notices, updated Gemini 4 codename recognition (`Neon` and `Argon`), and `product.json` version detection.
- **Antigravity session names and groups in T3 Code:** Prefer the T3 Code sidebar title when available, recover missing project names, and group related runs and delegated sessions.
- **Idle memory:** Release unused main-process memory sooner when none of Token Monitor's windows is focused.

### Fixed
- **Antigravity auto-switch and Windows probing:** Add periodic and activity-driven local quota probing, exclude the live keyring or credential account during auto-switch, verify live RPC identity after hot-switching with clean restart fallback, and harden Windows `Antigravity.exe` targeting, UTF-8 PowerShell process discovery, quoted CLI flags, and `GetUserStatus` timeouts.
- **Local Codex Work usage:** Record eligible Work tasks started on the web and run on this computer when experimental local collection is enabled.
- **Synced date ranges:** Keep Sessions and Projects visible while data refreshes for Yesterday, This week, Last 7 days, and Last 30 days, and prevent a device with confirmed zero usage from hiding other devices' details.
- **Large Hub uploads:** Preserve session details and the activity calendar for large usage histories when both the desktop app and Hub support the updated sync.
- **Rapid relaunch on Windows:** Reuse the existing main window when Token Monitor is launched twice in quick succession, preventing overlapping windows and flicker.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-Setup-0.106.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.106.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.0-x86_64.AppImage` then run it.

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
- **Antigravity 账号切换后任务自动续跑：** 检测到因限额触发或切换重启而中断的 Antigravity 对话后，在目标语言服务器重新就绪时通过 `agentapi` 自动发送可自定义的继续提示词以恢复任务。
- **Antigravity 回合状态与 T3 Code ACP 实时活跃：** 可在 Antigravity 桌面端与 CLI 中查看回合开始与结束状态；T3 Code 中的活跃 Antigravity ACP 会话会在产生首批 Token 前提前显示，并在两次用量更新之间保持运行状态。
- **T3 Code 中的 Kiro 会话归组：** 将同一 T3 Code 线程下的多次运行及委派子会话归并展示。

### 变更
- **本机 Codex Work 设置命名：** 将实验性 Dots 开关更名为「收集本机 Codex Work 用量」与「显示本机 Codex Work 用量」，适用于没有会话日志的本机 Work 任务。

### 改进
- **Antigravity 账号池分组配额卡片与模型提示：** 按模型家族分组展示配额桶与包含模型提示，补充清晰的 `5h` / 周限标签、已停用配额桶标记与受 5h 限制提示，并更新 Gemini 4 代号识别（`Neon` / `Argon`）与 `product.json` 版本检测。
- **T3 Code 中的 Antigravity 会话名称与分组：** 优先展示 T3 Code 侧边栏标题、补全缺失项目名，并对关联运行与委派会话进行归组。
- **空闲内存回收：** 当 Token Monitor 所有窗口均未获得焦点时，更快释放主进程闲置内存。

### 修复
- **Antigravity 自动切号与 Windows 探测加固：** 新增定时与活跃驱动的本地限额探测，在自动切号时排除本地钥匙串/凭据正在使用的账号，热切后校验实时 RPC 账号并在不一致时回退完整重启；同时加固 Windows `Antigravity.exe` 客户端定位、PowerShell UTF-8 进程探测、带引号 CLI 参数解析及 `GetUserStatus` 超时处理。
- **本机 Codex Work 用量记录：** 开启实验性本机收集后，可准确记录从网页发起并在本机执行的符合条件 Work 任务。
- **同步统计区间明细：** 在刷新「昨天」「本周」「最近 7 天」「最近 30 天」时持续保留会话与项目明细，且已确认零用量的设备不再隐藏其他设备的明细。
- **大批量 Hub 上传明细：** 桌面端与 Hub 均支持新版同步时，在大量历史用量记录中完整保留会话明细与活动日历。
- **Windows 快速连续启动：** 短时间内连续启动两次时复用已有主窗口，避免窗口重叠与闪烁。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-Setup-0.106.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.106.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.106.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.106.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale dependency

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.105.0...v0.106.0">v0.105.0...v0.106.0</a></summary>

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
- **Antigravity 帳號切換後任務自動續跑：** 偵測到因限額觸發或切換重啟而中斷的 Antigravity 對話後，在目標語言伺服器重新就緒時透過 `agentapi` 自動傳送可自訂的繼續提示詞以恢復任務。
- **Antigravity 回合狀態與 T3 Code ACP 即時活躍：** 可在 Antigravity 桌面版與 CLI 中檢視回合開始與結束狀態；T3 Code 中的活躍 Antigravity ACP 工作階段會在產生首批 tokens 前提前顯示，並在兩次用量更新之間維持執行狀態。
- **T3 Code 中的 Kiro 工作階段分組：** 將同一 T3 Code 執行緒下的多次執行及委派子工作階段歸併顯示。

### 變更
- **本機 Codex Work 設定命名：** 將實驗性 Dots 開關更名為「收集本機 Codex Work 用量」與「顯示本機 Codex Work 用量」，適用於沒有工作階段記錄的本機 Work 任務。

### 改進
- **Antigravity 帳號池分組配額卡片與模型提示：** 依模型家族分組顯示配額桶與包含模型提示，補充清楚的 `5h` / 週限標籤、已停用配額桶標記與受 5h 限制提示，並更新 Gemini 4 代號識別（`Neon` / `Argon`）與 `product.json` 版本偵測。
- **T3 Code 中的 Antigravity 工作階段名稱與分組：** 優先顯示 T3 Code 側邊欄標題、補齊缺少的專案名稱，並將關聯執行與委派工作階段分組。
- **閒置記憶體回收：** 當 Token Monitor 所有視窗皆未取得焦點時，更快釋放主程序閒置記憶體。

### 修復
- **Antigravity 自動切號與 Windows 探測加固：** 新增定時與活躍驅動的本機限額探測，在自動切號時排除本機鑰匙圈或憑證正在使用的帳號，熱切後校驗即時 RPC 帳號並在不一致時回退完整重啟；同時加固 Windows `Antigravity.exe` 用戶端定位、PowerShell UTF-8 程序探測、帶引號 CLI 參數解析及 `GetUserStatus` 逾時處理。
- **本機 Codex Work 用量記錄：** 開啟實驗性本機收集後，可正確記錄從網頁發起並在本機執行的符合條件 Work 任務。
- **同步統計範圍明細：** 在重新整理「昨日」「本星期」「最近 7 日」「最近 30 日」時持續保留工作階段與專案明細，且已確認零用量的裝置不再隱藏其他裝置的明細。
- **大量 Hub 上傳明細：** 桌面應用程式與 Hub 皆支援新版同步時，在大量歷史用量記錄中完整保留工作階段明細與活動日曆。
- **Windows 快速連續啟動：** 短時間內連續啟動兩次時沿用既有主視窗，避免視窗重疊與閃爍。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-Setup-0.106.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.106.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **Antigravity 전환 후 작업 자동 재개:** 할당량 도달이나 계정 전환 재시작으로 중단된 Antigravity 대화를 감지해 새 언어 서버가 온라인이 되면 `agentapi`로 사용자 지정 계속 메시지를 자동 전송합니다.
- **Antigravity 턴 상태 및 T3 Code ACP 실시간 활성:** Antigravity 데스크톱과 CLI에서 턴 시작과 종료를 확인할 수 있으며, T3 Code의 활성 Antigravity ACP 세션은 첫 토큰이 기록되기 전부터 표시되고 갱신 사이에도 실행 상태를 유지합니다.
- **T3 Code의 Kiro 세션 그룹화:** 같은 T3 Code 스레드 아래 관련 실행과 위임된 세션을 함께 묶어 표시합니다.

### 변경
- **로컬 Codex Work 설정 이름 변경:** 실험용 Dots 스위치를 세션 로그가 없는 로컬 Work 작업에 맞춰 ‘로컬 Codex Work 사용량 수집’과 ‘로컬 Codex Work 사용량 표시’로 변경했습니다.

### 개선
- **Antigravity 계정 풀 그룹화 할당량 카드 및 모델 힌트:** 모델 패밀리별 할당량 그룹과 포함 모델 힌트, `5h` 및 주간 창 배지, 비활성화된 버킷 표시, 5h 제한 주간 안내, 최신 Gemini 4 코드명(`Neon` / `Argon`) 인식 및 `product.json` 버전 감지를 지원합니다.
- **T3 Code의 Antigravity 세션 이름 및 그룹:** T3 Code 사이드바 제목을 우선 표시하고 누락된 프로젝트 이름을 보완하며 관련 실행과 위임된 세션을 함께 묶습니다.
- **유휴 메모리 회수:** Token Monitor 창에 포커스가 없을 때 사용하지 않는 메인 프로세스 메모리를 더 빨리 반환합니다.

### 수정
- **Antigravity 자동 전환 및 Windows 탐지 강화:** 주기적 및 활동 기반 로컬 할당량 탐지를 추가하고, 자동 전환 시 활성 키체인·자격 증명 계정을 제외하며, 핫스위치 후 실시간 RPC 계정을 검증해 불일치 시 전체 재시작으로 폴백합니다. 또한 Windows `Antigravity.exe` 대상 판별, PowerShell UTF-8 프로세스 조회, 따옴표 CLI 인자 파싱 및 `GetUserStatus` 타임아웃 처리를 강화했습니다.
- **로컬 Codex Work 사용량 기록:** 실험용 로컬 수집이 켜져 있을 때 웹에서 시작해 이 컴퓨터에서 실행된 적격 Work 작업을 기록합니다.
- **동기화된 날짜 범위 세부 내역:** ‘어제’, ‘이번 주’, ‘최근 7일’, ‘최근 30일’을 새로고침할 때 세션과 프로젝트 내역을 유지하며, 사용량이 0으로 확인된 기기가 다른 기기의 내역을 가리지 않습니다.
- **대용량 Hub 업로드 보존:** 데스크톱 앱과 Hub가 모두 업데이트된 동기화를 지원하면 대량 사용 기록에서도 세션 내역과 활동 캘린더를 유지합니다.
- **Windows 연속 실행 창 재사용:** 짧은 간격으로 두 번 실행할 때 기존 기본 창을 재사용해 창 겹침과 깜박임을 방지합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-Setup-0.106.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.106.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **Antigravity 切替後のタスク自動再開：** 上限到達や切替再起動で中断された Antigravity の会話を検出し、切替後の言語サーバーがオンラインになった時点で `agentapi` 経由の継続メッセージを自動送信します。
- **Antigravity のターン状態と T3 Code ACP リアルタイム稼働表示：** Antigravity デスクトップ版と CLI でターンの開始と終了を確認でき、T3 Code の有効な Antigravity ACP セッションは最初のトークン記録前から表示され更新の間も実行状態を維持します。
- **T3 Code の Kiro セッション統合：** 関連する実行や委任されたセッションを T3 Code スレッド単位でまとめて表示します。

### 変更
- **ローカル Codex Work 設定の名称変更：** 実験的な Dots スイッチを、セッションログのないローカル Work タスク向けに「ローカルの Codex Work 使用量を収集」「ローカルの Codex Work 使用量を表示」へ変更しました。

### 改善
- **Antigravity マネージャーのグループ別クォータカードとモデルヒント：** モデルファミリー別のグループ表示と対象モデルヒント、`5h` / 週間ウィンドウバッジ、無効化されたバケット表示、5h 上限による週間制限表示、Gemini 4 コードネーム（`Neon` / `Argon`）認識、`product.json` バージョン検出に対応しました。
- **T3 Code の Antigravity セッション名とグループ：** サイドバータイトルを優先表示し、不足しているプロジェクト名を補完して関連実行や委任セッションをグループ化します。
- **待機時メモリの解放：** Token Monitor のウィンドウがいずれもフォーカスされていないとき、未使用のメインプロセスメモリをより早く解放します。

### 修正
- **Antigravity 自動切替と Windows 検出の強化：** 定期的およびアクティビティ連動のローカルクォータ検出を追加し、自動切替時に現在のキーチェーン／資格情報アカウントを除外してホットスウィッチ後の RPC アカウント不一致時にクリーン再起動へフォールバックします。さらに Windows の `Antigravity.exe` 判定、UTF-8 PowerShell プロセス取得、引用符付き CLI 引数解析、`GetUserStatus` タイムアウト処理を強化しました。
- **ローカル Codex Work 使用量の記録：** 実験的なローカル収集が有効な場合、Web から開始されこの端末で実行された対象 Work タスクを記録します。
- **同期日付範囲の内訳保持：** 「昨日」「今週」「過去7日間」「過去30日間」の更新中もセッションとプロジェクトの内訳を表示し続け、使用量ゼロが確認された端末が他端末の内訳を隠さないよう修正しました。
- **Hub への大容量アップロード：** デスクトップアプリと Hub の双方が新同期方式に対応している場合、履歴が多い環境でもセッション詳細とアクティビティカレンダーを保持します。
- **Windows での連続起動：** 短時間に2回起動しても既存のメインウィンドウを再利用し、ウィンドウの重複やちらつきを防ぎます。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-Setup-0.106.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.106.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.106.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.106.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.106.0/Token-Monitor-0.106.0-x86_64.AppImage)

</details>

</details>
