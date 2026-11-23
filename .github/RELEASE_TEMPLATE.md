# English

## What's changed

<!-- app-update-notes:en:start -->
### Added
- **Native Hub HTTPS & Certificate Import:** Added native Node Hub TLS 1.2–1.3 listener support (`--tls-cert` / `--tls-key` for PEM and `--tls-pfx` / `--tls-passphrase-file` for encrypted PKCS#12 `.p12`/`.pfx`), zero-downtime certificate hot-reload via `server.setSecureContext()` and `SIGHUP`, `Strict-Transport-Security` on TLS responses, and certificate bundle import/validation (`src/shared/tlsCert.js`, `src/hub/tls.js`).
- **Desktop, Agent & MCP Custom CA Pinning:** Added custom CA trust pinning (`--tls-ca` / `TOKEN_MONITOR_TLS_CA_FILE` and `src/shared/hubClientFetch.js`) across the Desktop client, headless Agent, and MCP server, plus Desktop Settings UI for importing, inspecting (subject, SHA-256 fingerprint, expiry), and clearing custom Hub CA or self-signed certificates per profile.

### Fixed
- **Hub Authentication, Transport & Storage Hardening:** Changed empty-secret Node Hub startup to bind `127.0.0.1` and fail closed (`503`) unless `--insecure-no-auth` is explicitly passed; enforced `>= 24`-char secrets on non-loopback binds with per-IP `401` rate limiting (`429`) and failure logging; added scoped `readSecret` and `ingestSecret` tokens; disabled `?secret=` query-string authentication; added DNS-rebinding `Host` validation, security headers, hardened HTTP timeouts, SSE connection caps, upfront `Content-Length` `413` checks, `64 KiB` control-route body limits, and `0600` atomic state persistence.
- **Data Models, Integrations, OpenClaw & MCP Security:** Blocked prototype pollution (`__proto__`, `constructor`, `prototype`) in usage and history aggregation and sanitized malformed history rows; prevented SSRF and credential exfiltration by clearing stored API/hook tokens when integration origins change and enforcing `redirect: 'error'`; restricted OpenClaw host provisioning and `queryPermissions` mutations to local/opt-in admin flows with direct atomic `openclaw.json` writes; capped `/api/mcp` JSON-RPC batch size/concurrency, report date ranges (`2000..2100`), WeChat QR sessions, and Antigravity/approval-alert device validation.
<!-- app-update-notes:en:end -->
## Download

- **Windows Installer** — [Token-Monitor-Setup-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-Setup-0.103.0.exe) (recommended)
- **Windows Portable** — [Token-Monitor-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0.exe) (no install required)
- **Linux amd64** — [Token-Monitor-0.103.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.103.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-x86_64.AppImage)

<details>
<summary><strong>First launch and other notes</strong></summary>

### First launch

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.103.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.103.0-x86_64.AppImage` then run it.

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
- **原生 Hub HTTPS 与证书导入：** 为 Node Hub 新增原生 TLS 1.2–1.3 HTTPS 监听支持（支持 PEM `--tls-cert`/`--tls-key` 与加密 PKCS#12 `.p12`/`.pfx` `--tls-pfx`/`--tls-passphrase-file`）、基于 `server.setSecureContext()` 与 `SIGHUP` 的零停机证书热重载、TLS 响应 `Strict-Transport-Security` 头以及证书链导入与校验模块（`src/shared/tlsCert.js`、`src/hub/tls.js`）。
- **桌面端、Agent 与 MCP 自定义 CA 证书信任：** 为桌面客户端、无头 Agent 与 MCP Server 新增自定义 CA 证书固定支持（`--tls-ca` / `TOKEN_MONITOR_TLS_CA_FILE` 与 `src/shared/hubClientFetch.js`），并在桌面端设置中支持按配置导入、查看（主题、SHA-256 指纹、有效期）与清除自定义 Hub CA 或自签名证书。

### 修复
- **Hub 认证、传输与持久化安全加固：** 无密钥启动时默认仅绑定 `127.0.0.1` 并默认拒绝请求（`503`，需显式开启 `--insecure-no-auth`）；非回环地址强制要求至少 24 位密钥并加入按 IP 的 `401` 速率限制（`429`）与失败日志；新增 `readSecret` 与 `ingestSecret` 分权令牌；禁用 URL `?secret=` 查询参数鉴权；补齐 DNS 重绑定 `Host` 校验、安全响应头、HTTP 超时控制、SSE 并发连接上限、`Content-Length` 前置 `413` 拦截、`64 KiB` 控制路由体积限制以及 `0600` 权限持久化。
- **数据模型、第三方集成、OpenClaw 与 MCP 防护：** 拦截用量与历史聚合中的原型污染（`__proto__`、`constructor`、`prototype`）并清洗异常历史记录；在集成服务域名变更时自动清空已存密钥、强制 `redirect: 'error'` 并拦截内网/回环 SSRF；限制远程 HTTP 修改 `queryPermissions` 与主机配置，改用直接原子写入 `openclaw.json` 并在警告中脱敏密钥；限制 `/api/mcp` JSON-RPC 批处理大小与并发、报告年份范围（`2000..2100`）、微信扫码会话上限以及 Antigravity/审批提醒设备校验。
<!-- app-update-notes:zh:end -->

## 下载

- **Windows 安装版** — [Token-Monitor-Setup-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-Setup-0.103.0.exe)（推荐）
- **Windows 便携版** — [Token-Monitor-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0.exe)（免安装）
- **Linux amd64** — [Token-Monitor-0.103.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.103.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-x86_64.AppImage)

<details>
<summary><strong>首次启动与其他说明</strong></summary>

### 首次启动

**Windows:** Unsigned fork executables; Windows may show an unknown publisher warning.

**Linux:** `.deb`: `sudo apt install ./Token-Monitor-0.103.0-amd64.deb`; AppImage: `chmod +x Token-Monitor-0.103.0-x86_64.AppImage` then run it.

### 其他说明

This fork publishes Windows x64 and Linux Debian / AppImage packages.

### tokscale 依赖

Tokscale 已随应用内置，并通过 Token Monitor 发布版本更新。你可以在 **设置 → 常规 → 高级 → Tokscale** 查看版本和 fork 构建标识。Tokscale 是 MIT 开源项目：https://github.com/junhoyeo/tokscale

</details>

---

<details>
<summary><strong>Full Changelog:</strong> <a href="https://github.com/AoXIUy/token-monitor/compare/v0.102.2...v0.103.0">v0.102.2...v0.103.0</a></summary>

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
- **原生 Hub HTTPS 與憑證匯入：** 為 Node Hub 新增原生 TLS 1.2–1.3 HTTPS 監聽支援（支援 PEM `--tls-cert`/`--tls-key` 與加密 PKCS#12 `.p12`/`.pfx` `--tls-pfx`/`--tls-passphrase-file`）、基於 `server.setSecureContext()` 與 `SIGHUP` 的零停機憑證熱重載、TLS 回應 `Strict-Transport-Security` 標頭以及憑證鏈匯入與驗證模組（`src/shared/tlsCert.js`、`src/hub/tls.js`）。
- **桌面端、Agent 與 MCP 自訂 CA 憑證信任：** 為桌面用戶端、無頭 Agent 與 MCP Server 新增自訂 CA 憑證釘選支援（`--tls-ca` / `TOKEN_MONITOR_TLS_CA_FILE` 與 `src/shared/hubClientFetch.js`），並在桌面端設定中支援依設定檔匯入、檢視（主體、SHA-256 指紋、到期日）與清除自訂 Hub CA 或自簽名憑證。

### 修復
- **Hub 驗證、傳輸與持久化安全加固：** 無密鑰啟動時預設僅綁定 `127.0.0.1` 並拒絕請求（`503`，需顯式開啟 `--insecure-no-auth`）；非迴路位址強制要求至少 24 字元密鑰並加入依 IP 的 `401` 速率限制（`429`）與失敗記錄；新增 `readSecret` 與 `ingestSecret` 分權權杖；停用 URL `?secret=` 查詢參數驗證；補齊 DNS 重新綁定 `Host` 驗證、安全回應標頭、HTTP 逾時控制、SSE 連線上限、`Content-Length` 前置 `413` 攔截、`64 KiB` 控制路由大小限制及 `0600` 權限持久化。
- **資料模型、第三方整合、OpenClaw 與 MCP 防護：** 攔截用量與歷史聚合中的原型污染（`__proto__`、`constructor`、`prototype`）並清理異常歷史記錄；在整合服務網域變更時自動清空已存密鑰、強制 `redirect: 'error'` 並攔截內網/迴路 SSRF；限制遠端 HTTP 修改 `queryPermissions` 與主機設定，改用直接原子寫入 `openclaw.json` 並在警告中遮罩密鑰；限制 `/api/mcp` JSON-RPC 批次大小與並行數、報告年份範圍（`2000..2100`）、WeChat QR 登入工作階段上限以及 Antigravity/審批提醒裝置驗證。
<!-- app-update-notes:zh-TW:end -->

## 下載

- **Windows 安裝版** — [Token-Monitor-Setup-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-Setup-0.103.0.exe)（推薦）
- **Windows 便攜版** — [Token-Monitor-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0.exe)（免安裝）
- **Linux amd64** — [Token-Monitor-0.103.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.103.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-x86_64.AppImage)

</details>

<details>
<summary><strong>한국어</strong></summary>

## 한국어

## 업데이트 내용

<!-- app-update-notes:ko:start -->
### 추가
- **네이티브 Hub HTTPS 및 인증서 가져오기:** Node Hub에 네이티브 TLS 1.2–1.3 HTTPS 리스너 지원(PEM `--tls-cert`/`--tls-key` 및 암호화된 PKCS#12 `.p12`/`.pfx` `--tls-pfx`/`--tls-passphrase-file`), `server.setSecureContext()` 및 `SIGHUP` 기반 무중단 인증서 핫 리로드, TLS 응답 `Strict-Transport-Security` 헤더, 인증서 번들 가져오기 및 검증 모듈(`src/shared/tlsCert.js`, `src/hub/tls.js`)을 추가했습니다.
- **데스크톱, Agent 및 MCP 사용자 지정 CA 고정:** 데스크톱 클라이언트, 헤드리스 Agent, MCP 서버 전반에 사용자 지정 CA 신뢰 고정(`--tls-ca` / `TOKEN_MONITOR_TLS_CA_FILE` 및 `src/shared/hubClientFetch.js`)을 추가하고, 데스크톱 설정 UI에서 프로필별 사용자 지정 Hub CA 또는 자체 서명 인증서 가져오기·조회(주체, SHA-256 지문, 만료일)·삭제를 지원합니다.

### 수정
- **Hub 인증, 전송 및 저장소 보안 강화:** 비밀 키 없이 시작할 때 기본적으로 `127.0.0.1`에만 바인딩하고 요청을 거부(`503`, `--insecure-no-auth` 명시 필요)하도록 변경했으며, 비-루프백 바인딩 시 24자 이상 비밀 키 강제 및 IP별 `401` 속도 제한(`429`)·실패 로깅, `readSecret`/`ingestSecret` 범위별 토큰, `?secret=` 쿼리 인증 비활성화, DNS 리바인딩 `Host` 검증, 보안 응답 헤더, HTTP 타임아웃, SSE 연결 제한, 사전 `Content-Length` `413` 차단, `64 KiB` 제어 본문 제한 및 `0600` 파일 권한 저장을 적용했습니다.
- **데이터 모델, 통합, OpenClaw 및 MCP 보안:** 사용량 및 기록 집계에서 프로토타입 오염(`__proto__`, `constructor`, `prototype`)을 차단하고 손상된 기록 행을 정제하며, 통합 URL 출처 변경 시 저장된 API/훅 토큰을 초기화하고 `redirect: 'error'` 및 사설/루프백 SSRF 차단을 적용했습니다. 또한 원격 HTTP를 통한 `queryPermissions` 변경 및 호스트 프로비저닝을 제한하고 `openclaw.json` 직접 원자적 쓰기 및 경고 내 비밀 값 마스킹, `/api/mcp` 배치 크기·동시성 제한, 보고서 연도 범위(`2000..2100`), WeChat QR 세션 수 제한 및 Antigravity/승인 알림 장치 검증을 강화했습니다.
<!-- app-update-notes:ko:end -->

## 다운로드

- **Windows 설치 버전** — [Token-Monitor-Setup-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-Setup-0.103.0.exe) (권장)
- **Windows 포터블 버전** — [Token-Monitor-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0.exe) (설치 필요 없음)
- **Linux amd64** — [Token-Monitor-0.103.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.103.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-x86_64.AppImage)

</details>

<details>
<summary><strong>日本語</strong></summary>

## 日本語

## 更新内容

<!-- app-update-notes:ja:start -->
### 追加
- **ネイティブ Hub HTTPS と証明書インポート：** Node Hub にネイティブ TLS 1.2–1.3 HTTPS リスナー対応（PEM `--tls-cert`/`--tls-key` および暗号化 PKCS#12 `.p12`/`.pfx` `--tls-pfx`/`--tls-passphrase-file`）、`server.setSecureContext()` と `SIGHUP` による無停止証明書ホットリロード、TLS 応答の `Strict-Transport-Security` ヘッダー、および証明書バンドルのインポート・検証モジュール（`src/shared/tlsCert.js`、`src/hub/tls.js`）を追加しました。
- **デスクトップ・Agent・MCP のカスタム CA ピン留め：** デスクトップクライアント、ヘッドレス Agent、MCP サーバーにカスタム CA 信頼ピン留め（`--tls-ca` / `TOKEN_MONITOR_TLS_CA_FILE` と `src/shared/hubClientFetch.js`）を追加し、デスクトップ設定 UI でプロファイルごとにカスタム Hub CA または自己署名証明書のインポート・確認（サブジェクト、SHA-256 フィンガープリント、有効期限）・削除に対応しました。

### 修正
- **Hub 認証・通信・保存のセキュリティ強化：** シークレット未設定時の起動を `127.0.0.1` バインドかつデフォルト拒否（`503`、`--insecure-no-auth` 明示時のみ許可）に変更し、非ループバックでの 24 文字以上のシークレット強制と IP 単位の `401` レート制限（`429`）・失敗ログ記録、`readSecret`/`ingestSecret` スコープトークン、`?secret=` クエリ認証の廃止、DNS リバインディング `Host` 検証、セキュリティヘッダー、HTTP タイムアウト、SSE 接続数上限、事前 `Content-Length` `413` 拒否、`64 KiB` 制御ルート上限および `0600` 権限での永続化を適用しました。
- **データモデル・外部連携・OpenClaw・MCP の保護：** 使用量・履歴集計でのプロトタイプ汚染（`__proto__`、`constructor`、`prototype`）防止と不正な履歴行のサニタイズ、連携先オリジン変更時の保存済み API/フックトークン自動消去と `redirect: 'error'`・プライベート/ループバック SSRF 遮断、リモート HTTP からの `queryPermissions` 変更やホスト設定の制限および `openclaw.json` の直接アトミック書き込みと警告メッセージの秘密情報マスク、`/api/mcp` バッチサイズ・並列数上限、レポート年範囲（`2000..2100`）、WeChat QR セッション上限、Antigravity/承認通知のデバイス検証を強化しました。
<!-- app-update-notes:ja:end -->

## ダウンロード

- **Windows インストーラー** — [Token-Monitor-Setup-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-Setup-0.103.0.exe)（推奨）
- **Windows ポータブル版** — [Token-Monitor-0.103.0.exe](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0.exe)（インストール不要）
- **Linux amd64** — [Token-Monitor-0.103.0-amd64.deb](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-amd64.deb)
- **Linux x86_64 AppImage** — [Token-Monitor-0.103.0-x86_64.AppImage](https://github.com/AoXIUy/token-monitor/releases/download/v0.103.0/Token-Monitor-0.103.0-x86_64.AppImage)

</details>

</details>
