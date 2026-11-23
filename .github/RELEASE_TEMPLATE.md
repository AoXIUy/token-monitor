# English

## What's changed

<!-- app-update-notes:en:start -->
### Fixed
- **Account Manager Switching, Keyring & Process Detection:** Hardened Antigravity Classic/IDE switching, hot-switch `language_server` respawn tracking (`excludePids` and target isolation), POSIX/macOS spaced-path and quoted `--user-data-dir` parsing, helper-process filtering, Windows Registry custom-drive executable lookup, clean Electron/AppImage spawn environment, and Windows Credential Manager reliability (anonymous Koffi structs avoiding symbol collisions, 2560-byte blob cap fallback, UTF-8/UTF-16LE decoding, and removing destructive pre-delete writes).
- **Encrypted Storage, State DB, Quota, OAuth & Hub Sync:** Hardened `tokens.enc` to fail closed on corrupt or symlinked files with write rollback, wrapped SQLite `state.vscdb` token injection in atomic `BEGIN IMMEDIATE` transactions (fixing `isGcpTos` decoding), preserved proto3 `0%` depleted quota buckets and `401`/`403`/abort handling, tightened OAuth login timeouts/state checks and rotated refresh token persistence, blocked import path traversal, fixed scheduler refresh state/baseline tracking, separated Hub sync fetch from provider proxy transport, and preserved Hub `banCode`/`accountCount` with persistence rollback.
- **Account Manager Themes, Layout, Accessibility & i18n:** Fixed the standalone Account Manager script load order so Porcelain light theme, theme presets, and custom fonts render cleanly instead of getting stuck in dark mode; fixed z-index and viewport flip on card menus and popovers, 3-segment Refresh/Cancel split styling, full-width readable fallback model rows, state/progress-bar synchronization, IPC clipboard copy, two-step batch delete confirmation, keyboard (`Escape`/arrow) navigation, OAuth dialog-close cancellation, and 7-language localization including all ARIA labels.
- **Main Widget Footer & Limits Bar:** Hid `#limitsToolsBar` across all non-Limits views, replaced hardcoded dark colors on `.limits-tool-btn` with theme-aware tokens and Liquid Glass parity, and prevented narrow (`240px`) footer overlap between the live token rate, `#viewSwitcher`, and the Account Manager button.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-Setup-0.102.2.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.102.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.102.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.102.2-x86_64.AppImage` then run it.

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
- **账号切换、系统密钥链与进程识别：** 加固 Antigravity Classic / IDE 切换流程，修复热切换 `language_server` 重生检测（`excludePids` 与目标隔离）、POSIX/macOS 含空格路径与带引号 `--user-data-dir` 解析、辅助子进程过滤、Windows 注册表自定义盘符路径发现、子进程 Electron/AppImage 环境变量清理，以及 Windows 凭据管理器稳定性（匿名 Koffi 结构体避免符号冲突、2560 字节凭据上限降级、UTF-8/UTF-16LE 解码及移除破坏性预删除）。
- **加密存储、State DB、配额、OAuth 与 Hub 同步：** 加固 `tokens.enc` 在损坏或符号链接场景下安全失败并支持写入回滚；为 SQLite `state.vscdb` 注入加入 `BEGIN IMMEDIATE` 原子事务并修复 `isGcpTos` 解码；保留 proto3 `0%` 耗尽配额桶并修正 `401`/`403`/中止处理；完善 OAuth 登录超时与状态校验、导入路径穿越防护及轮换 `refresh_token` 持久化；修复调度器刷新状态与基线跟踪，隔离 Hub 同步请求与代理通道，并在 Hub 侧保留 `banCode`/`accountCount` 及持久化失败回滚。
- **账号管理窗口主题、布局、无障碍与多语言：** 修复独立账号管理窗口脚本加载顺序，使 Porcelain 浅色主题、主题预设与自定义字体正常生效而不再卡在深色模式；修复卡片菜单与弹层的层级和视口翻转、刷新/取消三段式拆分按钮样式、回退模型行全宽展示、状态与进度条同步、IPC 剪贴板复制、批量删除两段式确认、键盘（`Escape`/方向键）导航、关闭弹窗时取消 OAuth 以及 7 语言文案与全部 ARIA 标签。
- **主窗口底部栏与 Limits 工具栏：** 在所有非 Limits 视图下正确隐藏 `#limitsToolsBar`，将 `.limits-tool-btn` 的硬编码深色值替换为主题自适应变量并对齐 Liquid Glass 样式，同时避免窄屏（`240px`）下实时输出速率、视图切换器与账号管理按钮重叠。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-Setup-0.102.2.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.102.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.102.2-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.102.2-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.102.1...v0.102.2">v0.102.1...v0.102.2</a></summary>

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
- **帳號切換、系統鑰匙圈與處理程序識別：** 加固 Antigravity Classic / IDE 切換流程，修復熱切換 `language_server` 重生偵測（`excludePids` 與目標隔離）、POSIX/macOS 含空格路徑與帶引號 `--user-data-dir` 解析、輔助子程序過濾、Windows 登錄檔自訂磁碟路徑偵測、子程序 Electron/AppImage 環境變數清理，以及 Windows 認證管理員穩定性（匿名 Koffi 結構避免符號衝突、2560 位元組上限降級、UTF-8/UTF-16LE 解碼與移除破壞性預刪除）。
- **加密儲存、State DB、額度、OAuth 與 Hub 同步：** 加固 `tokens.enc` 在損毀或符號連結時安全失敗並支援寫入回滾；為 SQLite `state.vscdb` 注入加入 `BEGIN IMMEDIATE` 原子交易並修復 `isGcpTos` 解碼；保留 proto3 `0%` 耗盡額度與修正 `401`/`403`/中止處理；強化 OAuth 逾時與狀態驗證、匯入路徑穿越防護及輪替 `refresh_token` 持久化；修復排程刷新狀態與基線追蹤，隔離 Hub 同步與代理通道，並在 Hub 保留 `banCode`/`accountCount` 及儲存回滾。
- **帳號管理視窗主題、排版、無障礙與多語系：** 修復獨立帳號管理視窗腳本載入順序，讓 Porcelain 淺色主題、主題預設與自訂字型正常套用；修復卡片選單與彈窗的層級與視窗翻轉、重新整理/取消三段拆分按鈕樣式、回退模型列全寬顯示、狀態與進度列同步、IPC 剪貼簿複製、批次刪除兩段式確認、鍵盤（`Escape`/方向鍵）導覽、關閉對話框時取消 OAuth 及 7 語系文案與全部 ARIA 標籤。
- **主視窗底部列與 Limits 工具列：** 在所有非 Limits 檢視中正確隱藏 `#limitsToolsBar`，將 `.limits-tool-btn` 硬編碼深色值改為主題自適應變數並對齊 Liquid Glass 樣式，同時避免窄視窗（`240px`）下即時輸出速率、檢視切換器與帳號管理按鈕重疊。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-Setup-0.102.2.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.102.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 수정
- **계정 전환, 시스템 키링 및 프로세스 감지:** Antigravity Classic/IDE 전환 안정화, 핫스위치 `language_server` 재생성 추적(`excludePids` 및 대상 격리), POSIX/macOS 공백 경로 및 따옴표 `--user-data-dir` 파싱, 헬퍼 프로세스 필터링, Windows 레지스트리 사용자 지정 드라이브 경로 탐색, Electron/AppImage 하위 프로세스 환경 정리, Windows 자격 증명 관리자 안정성(익명 Koffi 구조체 충돌 방지, 2560바이트 제한 대응, UTF-8/UTF-16LE 디코딩, 선행 삭제 제거)을 수정했습니다.
- **암호화 저장소, State DB, 할당량, OAuth 및 Hub 동기화:** 손상·심볼릭 링크 `tokens.enc` 안전 실패 및 쓰기 롤백, SQLite `state.vscdb` `BEGIN IMMEDIATE` 원자적 트랜잭션 및 `isGcpTos` 디코딩 수정, proto3 `0%` 소진 할당량 유지 및 `401`/`403`/중단 처리, OAuth 타임아웃·상태 검증과 회전된 `refresh_token` 저장, 가져오기 경로 순회 차단, 스케줄러 새로고침 상태/기준 분리, Hub 전용 fetch 분리 및 `banCode`/`accountCount`·롤백 보강을 적용했습니다.
- **계정 관리 창 테마, 레이아웃, 접근성 및 다국어:** 독립 계정 관리 창 스크립트 로드 순서를 수정해 Porcelain 라이트 테마·테마 프리셋·사용자 글꼴이 정상 적용되도록 했으며, 카드 메뉴/팝오버 z-index 및 뷰포트 반전, 3분할 새로고침/취소 버튼, 전체 너비 폴백 모델 행, 진행 표시줄 동기화, IPC 클립보드 복사, 일괄 삭제 2단계 확인, 키보드(`Escape`/화살표) 탐색, 다이얼로그 종료 시 OAuth 취소, 7개 언어 및 모든 ARIA 라벨을 수정했습니다.
- **메인 위젯 하단 및 Limits 도구 모음:** 비-Limits 화면에서 `#limitsToolsBar`를 숨기고 `.limits-tool-btn`에 테마 토큰과 Liquid Glass 스타일을 적용했으며, 좁은 폭(`240px`)에서 실시간 토큰 속도·뷰 전환기·계정 관리 버튼이 겹치지 않도록 수정했습니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-Setup-0.102.2.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.102.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 修正
- **アカウント切替・システムキーリング・プロセス検出：** Antigravity Classic/IDE 切替、ホットスワップ時の `language_server` 再起動監視（`excludePids` と対象分離）、POSIX/macOS の空白パスや引用符付き `--user-data-dir` 解析、ヘルパープロセス除外、Windows レジストリのカスタムドライブ探索、起動時 Electron/AppImage 環境変数クリーンアップ、Windows 資格情報マネージャー（匿名 Koffi 構造体による衝突回避、2560 バイト上限フォールバック、UTF-8/UTF-16LE デコード、破壊的事前削除の廃止）を修正しました。
- **暗号化保存・State DB・クォータ・OAuth・Hub 同期：** 破損・シンボリックリンク時の `tokens.enc` フェイルクローズと書き込みロールバック、SQLite `state.vscdb` への `BEGIN IMMEDIATE` 原子トランザクションと `isGcpTos` デコード修正、proto3 の `0%` 枯渇バケット保持と `401`/`403`/中断処理、OAuth タイムアウト・状態検証とローテーション済み `refresh_token` 保存、インポートのパストラバーサル防止、スケジューラー更新状態/基準分離、Hub 同期 fetch 分離および `banCode`/`accountCount` 保持とロールバックを強化しました。
- **アカウント管理画面のテーマ・レイアウト・アクセシビリティ・多言語：** スクリプト読込順序を修正して Porcelain ライトテーマ・プリセット・カスタムフォントが正しく適用されるようにし、メニュー/ポップオーバーの重なりと反転、更新/キャンセル 3 分割ボタン、フォールバックモデル行の全幅表示、進捗バー同期、IPC クリップボードコピー、一括削除の 2 段階確認、キーボード（`Escape`/矢印）操作、ダイアログ終了時の OAuth キャンセル、7 言語と全 ARIA ラベルを修正しました。
- **メインウィジェット下部と Limits ツールバー：** 非 Limits 画面で `#limitsToolsBar` を非表示にし、`.limits-tool-btn` をテーマ連動トークンと Liquid Glass 対応に改め、狭幅（`240px`）フッターでのライブ速度・ビュー切替・アカウント管理ボタンの重なりを解消しました。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-Setup-0.102.2.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.102.2.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.102.2-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.102.2-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.102.2/Token-Monitor-0.102.2-x86_64.AppImage)

</details>

</details>
