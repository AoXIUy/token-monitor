# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- Antigravity and Codex session details now show observed output tok/s, tok/min and a five-minute rate trend on desktop and Android.
- Rates use changes in source-device output counters and timestamps. Duplicate snapshots add no points; unavailable data stays unavailable.
- Select one device copy independently. Switching sources or resetting counters starts a new baseline; offline intervals remain gaps.
### Notes
- Monitoring starts when the detail view opens. Completion-only usage logs produce batched observations, not per-token streaming; cumulative matched timing is not used for these rates.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-Setup-0.92.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.92.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.92.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.92.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.92.0-x86_64.AppImage` then run it.

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
- 安卓与桌面 Antigravity / Codex 会话详情增加实时输出 tok/s、tok/min 和五分钟速率趋势。
- 按来源设备输出计数与时间戳的真实增量计算；重复快照不增加采样，缺失数据不伪造零值。
- 多设备副本可单独选择，切换来源或计数回退后重新建立基线，离线时曲线留空。
### 说明
- 打开详情后开始监控。仅在回复结束时写入的用量日志形成批量观测，不代表逐 Token 流速；新速率不使用累计匹配均速。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-Setup-0.92.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.92.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.92.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.92.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.92.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.91.3...v0.92.0">v0.91.3...v0.92.0</a></summary>

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
- 桌面與 Android 的 Antigravity / Codex 會話詳情新增輸出 tok/s、tok/min 與五分鐘速率趨勢。
- 依來源裝置輸出計數與時間戳記的實際增量計算；重複快照不增加樣本，缺失資料不補零。
- 可分別選擇裝置副本；切換來源或計數重設後重新建立基準，離線區間保留空白。
### 說明
- 開啟詳情後開始監控。僅在回覆結束時寫入的日誌屬於批次觀測，不代表逐 Token 串流速度；不使用累計平均速度。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-Setup-0.92.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.92.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.92.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- 데스크톱과 Android의 Antigravity / Codex 세션 상세에 출력 tok/s, tok/min 및 최근 5분 속도 추세를 추가했습니다.
- 소스 기기의 출력 카운터와 타임스탬프 차이로 계산하며, 중복 스냅샷이나 누락 데이터로 샘플을 만들지 않습니다.
- 기기별 사본을 선택할 수 있습니다. 소스 변경이나 카운터 초기화 시 기준을 다시 설정하고 오프라인 구간은 비워 둡니다.
### 참고
- 상세 화면을 열면 관측을 시작합니다. 응답 완료 시에만 기록되는 로그는 일괄 관측이며 토큰별 스트리밍 속도가 아닙니다. 누적 평균 속도를 사용하지 않습니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-Setup-0.92.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.92.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.92.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- デスクトップと Android の Antigravity / Codex セッション詳細に出力 tok/s、tok/min、直近5分の速度推移を追加しました。
- 取得元端末の出力カウンターとタイムスタンプの差分で計算し、重複スナップショットや欠損データからサンプルを生成しません。
- 端末ごとのコピーを選択できます。取得元の変更やカウンターのリセット後は基準を再設定し、オフライン区間は空白にします。
### 注意
- 詳細を開くと観測を開始します。応答完了時のみ更新されるログは一括観測であり、トークン単位のストリーミング速度ではありません。累積平均速度は使用しません。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-Setup-0.92.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.92.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.92.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.92.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.92.0/Token-Monitor-0.92.0-x86_64.AppImage)

</details>

</details>
