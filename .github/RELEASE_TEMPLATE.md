# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Upstream v0.95.1 & v0.96.0 Sync — Sync Map & Diagnostics:** Synced [Javis603/token-monitor v0.96.0](https://github.com/Javis603/token-monitor/releases/tag/v0.96.0) (`39606ac3`), adding the Multi-device Sync visual Hub-and-devices map, built-in vs standalone Hub deployment identification, and data hints on untracked tools and disabled limits.
- **Notion AI Personal Pools & Devin Email:** Added Notion AI personal `Standard` and `Select` credit pools and displayed login email on Devin quota cards.
- **MiniMax Code Relocated Stores:** Added session usage collection from relocated MiniMax Code stores.

### Changed
- **Window Settings & Grouped Cards:** Redesigned Window settings with a surface switcher and structured cards, and matched history limit rows with rail hover glow.
- **Landing Page Assets:** Updated landing page assets and tool icons for `v0.95`+.

### Improved
- **Idle Memory, Hibernation & Screen Lock Suspension:** Added tray main-window hibernation, unfocused idle heap collection, tray UI suspension while the screen is locked, and lower idle memory overhead on full scans.
- **Watchers & Identity Caching:** Stopped watching compressed Codex archives, cached Cursor quota account identity, and cut widget/visible-stats memory churn.
- **Trend Stroke & Regional Fonts:** Preserved consistent daily usage trend line stroke widths on wider windows and improved Windows regional Chinese glyph font fallback.

### Fixed
- **Antigravity Desktop Sync & Grouped Quota:** Restored Antigravity desktop RPC sync and preserved grouped quotas across refresh failures while keeping fork `<root>/daemon/*.json` PID discovery and Gemini 4 fallback pools.
- **Qoder & Z.ai Team Multi-Project Isolation:** Kept synced Qoder accounts isolated across devices and separated Z.ai Team multi-project quotas cleanly.
- **Calendar Gaps, Window Minimize & Copilot Refresh:** Preserved calendar gaps in usage trends, prevented a blank main window after minimize on Windows, and refreshed Copilot usage after exporter deletion.

### Notes
- **OpenClaw & Fork Capabilities:** Preserves all fork capabilities including online Antigravity / Codex conversations for Android, live session output rates, optional approval alerts, daily/weekly/monthly reports & MCP endpoints, and bidirectional OpenClaw integration.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-Setup-0.101.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.101.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.101.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.101.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.101.0-x86_64.AppImage` then run it.

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
- **同步上游 v0.95.1 与 v0.96.0 — 多设备同步地图与诊断：** 合并 [Javis603/token-monitor v0.96.0](https://github.com/Javis603/token-monitor/releases/tag/v0.96.0)（`39606ac3`），新增 Hub 与设备连接关系可视化同步地图、内置与独立 Hub 部署识别，以及未追踪工具和停用额度开关的数据提示。
- **Notion AI 个人积分池与 Devin 登录邮箱：** 新增 Notion AI 个人版 `Standard` / `Select` 点数池展示，并在 Devin 额度卡片展示登录邮箱。
- **MiniMax Code 迁移路径采集：** 支持从迁移后的 MiniMax Code 数据目录采集会话用量。

### 变更
- **窗口设置页与卡片布局：** 重构窗口设置页为视图切换器与结构化卡片布局，并为额度历史行补充侧栏同款悬停微光。
- **落地页资源：** 更新 `v0.95`+ 客户端图标与项目展示页面资源。

### 改进
- **闲置内存、窗口休眠与锁屏暂停：** 新增托盘后台主窗口休眠、失焦时闲置堆回收、系统锁屏时暂停托盘界面更新，并降低全量扫描的空闲内存占用。
- **文件监听与身份缓存：** 停止监听已压缩的 Codex 归档文件，缓存 Cursor 额度账户身份，并减少微件与可见统计刷新的内存抖动。
- **趋势线宽与字体渲染：** 在较宽窗口保持每日用量趋势线粗细一致，并优化 Windows 中文环境字形字体回退。

### 修复
- **Antigravity 桌面同步与分组额度：** 恢复 Antigravity 桌面端 RPC 同步并在刷新失败时保留已获取分组额度，同时完整保留本分支 `<root>/daemon/*.json` PID 端口探测与 Gemini 4 兜底分组。
- **Qoder 与 Z.ai Team 多设备/多项目隔离：** 修复跨设备同期 Qoder 账户误合并，并保持 Z.ai Team 多个项目额度独立显示。
- **日历缺口、最小化白屏与 Copilot 刷新：** 在用量趋势中保留真实日历缺口、修复 Windows 最小化后主窗口偶现空白的问题，以及删除导出器后自动刷新 Copilot 用量。

### 说明
- **OpenClaw 与分支扩展能力：** 完整保留本分支全部特性，包括安卓端在线 Antigravity / Codex 对话查阅、实时会话输出速率、可选审批提醒、日报/周报/月报与 MCP 接口，以及 OpenClaw 双向集成。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-Setup-0.101.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.101.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.101.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.101.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.101.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.100.1...v0.101.0">v0.100.1...v0.101.0</a></summary>

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
- **同步上游 v0.95.1 與 v0.96.0 — 多裝置同步地圖與診斷：** 合併 [Javis603/token-monitor v0.96.0](https://github.com/Javis603/token-monitor/releases/tag/v0.96.0)（`39606ac3`），新增 Hub 與裝置連線關係視覺化同步地圖、內建與獨立 Hub 部署識別，以及未追蹤工具與停用額度開關的資料提示。
- **Notion AI 個人點數池與 Devin 登入信箱：** 新增 Notion AI 個人版 `Standard` / `Select` 點數池顯示，並在 Devin 額度卡片顯示登入信箱。
- **MiniMax Code 遷移路徑擷取：** 支援從遷移後的 MiniMax Code 資料目錄收集工作階段用量。

### 變更
- **視窗設定頁與卡片版面：** 重構視窗設定頁為檢視切換器與結構化卡片版面，並為額度歷史列加上側欄同款懸停微光。
- **著陸頁資源：** 更新 `v0.95`+ 用戶端圖示與專案展示頁資源。

### 改進
- **閒置記憶體、視窗休眠與鎖屏暫停：** 新增系統匣背景主視窗休眠、失焦時閒置堆積回收、系統鎖屏時暫停系統匣介面更新，並降低全量掃描的空閒記憶體佔用。
- **檔案監聽與身分快取：** 停止監聽已壓縮的 Codex 歸檔檔案，快取 Cursor 額度帳號身分，並減少微件與可見統計更新的記憶體抖動。
- **趨勢線寬與字體渲染：** 在較寬視窗維持每日用量趨勢線粗細一致，並最佳化 Windows 中文環境字形字體回退。

### 修復
- **Antigravity 桌面同步與分組額度：** 恢復 Antigravity 桌面端 RPC 同步並在重新整理失敗時保留已取得分組額度，同時完整保留本分支 `<root>/daemon/*.json` PID 連接埠探索與 Gemini 4 備援分組。
- **Qoder 與 Z.ai Team 多裝置/多專案隔離：** 修復跨裝置同期 Qoder 帳號誤合併，並維持 Z.ai Team 多專案額度獨立顯示。
- **行事曆缺口、最小化白畫面與 Copilot 更新：** 在用量趨勢中保留真實行事曆缺口、修復 Windows 最小化後主視窗偶發空白的問題，以及刪除匯出器後自動更新 Copilot 用量。

### 說明
- **OpenClaw 與分支擴充功能：** 完整保留本分支全部特性，包含 Android 端線上 Antigravity / Codex 對話檢視、即時工作階段輸出速率、可選審批提醒、日報/週報/月報與 MCP 介面，以及 OpenClaw 雙向整合。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-Setup-0.101.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.101.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.101.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **상류 v0.95.1 및 v0.96.0 동기화 — 다중 기기 동기화 맵 및 진단:** [Javis603/token-monitor v0.96.0](https://github.com/Javis603/token-monitor/releases/tag/v0.96.0)(`39606ac3`)을 병합하여 Hub와 기기 연결 관계를 보여 주는 시각화 동기화 맵, 내장 및 독립형 Hub 배포 구분, 미추적 도구 및 비활성 한도 스위치 데이터 힌트를 추가했습니다.
- **Notion AI 개인 크레딧 풀 및 Devin 로그인 이메일:** Notion AI 개인 `Standard` / `Select` 크레딧 풀 표시를 추가하고 Devin 할당량 카드에 로그인 이메일을 표시합니다.
- **MiniMax Code 이전 경로 수집:** 이전된 MiniMax Code 저장소 경로에서 세션 사용량을 수집하도록 지원합니다.

### 변경
- **창 설정 및 카드 레이아웃:** 창 설정을 화면 전환기와 구조화된 카드로 개편하고, 한도 기록 행에 레일과 같은 호버 글로우를 추가했습니다.
- **랜딩 페이지 리소스:** `v0.95`+ 도구 아이콘과 프로젝트 랜딩 페이지 리소스를 업데이트했습니다.

### 개선
- **유휴 메모리, 창 절전 및 화면 잠금 일시 중지:** 트레이 백그라운드 메인 창 절전, 포커스 해제 시 유휴 힙 수집, 화면 잠금 시 트레이 UI 갱신 일시 중지를 추가하고 전체 스캔 시 유휴 메모리 사용량을 낮췄습니다.
- **감시 및 계정 신원 캐시:** 압축된 Codex 아카이브 파일 감시를 중단하고 Cursor 할당량 계정 신원을 캐시하며, 위젯 및 표시 통계 갱신 시 메모리 변동을 줄였습니다.
- **추세선 두께 및 지역 글꼴:** 넓은 창에서도 일별 사용량 추세선 두께를 일정하게 유지하고 Windows 중국어 글리프 글꼴 폴백을 개선했습니다.

### 수정
- **Antigravity 데스크톱 동기화 및 그룹 할당량:** Antigravity 데스크톱 RPC 동기화를 복구하고 갱신 실패 시에도 그룹 할당량을 보존하며, 포크의 `<root>/daemon/*.json` PID 탐색과 Gemini 4 폴백 풀을 유지했습니다.
- **Qoder 및 Z.ai Team 다중 기기·프로젝트 격리:** 기기 간 Qoder 계정이 섞이지 않도록 분리하고 Z.ai Team 다중 프로젝트 할당량을 각각 유지했습니다.
- **캘린더 공백, 최소화 빈 화면 및 Copilot 갱신:** 사용량 추세의 실제 캘린더 공백을 유지하고, Windows에서 최소화 후 메인 창이 비는 현상을 방지하며, 내보내기 삭제 후 Copilot 사용량을 다시 불러옵니다.

### 참고
- **OpenClaw 및 포크 확장 기능:** Android용 온라인 Antigravity / Codex 대화 조회, 실시간 세션 출력 속도, 선택형 승인 알림, 일간/주간/월간 리포트 및 MCP 엔드포인트, 양방향 OpenClaw 통합을 포함한 모든 포크 기능을 유지합니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-Setup-0.101.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.101.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.101.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **上流 v0.95.1 / v0.96.0 同期 — マルチデバイス同期マップと診断：** [Javis603/token-monitor v0.96.0](https://github.com/Javis603/token-monitor/releases/tag/v0.96.0)（`39606ac3`）を取り込み、Hub とデバイスの接続関係を示す同期マップ、内蔵 Hub と独立 Hub の識別、未追跡ツールや無効化された制限設定のデータヒントを追加しました。
- **Notion AI 個人クレジットプールと Devin メール表示：** Notion AI 個人向け `Standard` / `Select` クレジットプールを追加し、Devin クォータカードにログインメールアドレスを表示します。
- **MiniMax Code 移行先ストア収集：** 移行後の MiniMax Code 保存先からセッション使用量を収集できるようになりました。

### 変更
- **ウィンドウ設定とカードレイアウト：** ウィンドウ設定をサーフェススイッチャーとカード構成へ刷新し、履歴制限行にレールと同様のホバーグローを追加しました。
- **ランディングページ資産：** `v0.95`+ 向けのツールアイコンと紹介ページ資産を更新しました。

### 改善
- **待機メモリ・ハイバネーション・ロック画面停止：** トレイ常駐メインウィンドウの休止、非フォーカス時のアイドルヒープ回収、画面ロック中のトレイ UI 更新停止を導入し、フルスキャン時の待機メモリ使用量を削減しました。
- **監視対象とアカウント識別キャッシュ：** 圧縮済み Codex アーカイブの監視を停止し、Cursor クォータアカウント識別をキャッシュして、ウィジェット・表示統計更新時のメモリ負荷を抑えました。
- **トレンド線幅と地域フォント：** 広いウィンドウでも日別使用量トレンド線の太さを一定に保ち、Windows 環境での中国語グリフフォントのフォールバックを改善しました。

### 修正
- **Antigravity デスクトップ同期とグループ別クォータ：** Antigravity デスクトップ RPC 同期を復旧し更新失敗時もグループ別クォータを保持しつつ、フォーク独自の `<root>/daemon/*.json` PID 検出と Gemini 4 フォールバックプールを維持しました。
- **Qoder と Z.ai Team のマルチデバイス／プロジェクト分離：** デバイス間の Qoder アカウント分離を維持し、Z.ai Team の複数プロジェクトクォータが混在しないようにしました。
- **カレンダー空白・最小化後の白画面・Copilot 更新：** 使用量トレンドのカレンダー上の欠損日を保持し、Windows で最小化後にメインウィンドウが空白になる問題を防ぎ、エクスポーター削除後に Copilot 使用量を再取得します。

### 注意
- **OpenClaw およびフォーク独自機能：** Android 向けオンライン Antigravity / Codex 会話閲覧、リアルタイムセッション出力レート、任意承認アラート、日次/週次/月次レポートおよび MCP エンドポイント、OpenClaw 双方向連携などの独自機能を引き続きすべて備えています。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-Setup-0.101.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.101.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.101.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.101.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.101.0/Token-Monitor-0.101.0-x86_64.AppImage)

</details>

</details>
