# 此分支的正式桌面发布

发布仓库为 `AoXIUy/token-monitor`。发布源码必须通过 `npm run verify`，并有匹配的稳定版本 `package.json`、锁文件和 `docs/releases/<version>.md`。从 **Actions → Release → Run workflow → main** 手动发布，或推送 `v<version>` 标签触发 `.github/workflows/release.yml`，每次只选一种方式。手动发布按源码版本创建标签；已有标签必须指向当前源码提交。不要移动已发布标签或覆盖已公开附件。

工作流先在 Node 22 / 24 执行完整校验，然后构建 macOS Apple Silicon / Intel、Windows 安装版 / 便携版和 Linux x64。所有平台和签名校验通过后才发布，输出 `SHA256SUMS` 与记录源码 SHA 的 `release-metadata.json`。GitHub Release 说明使用源码中的已审阅版本说明，不依赖 fork 中不存在的上游历史标签。

## 签名配置

在仓库 **Settings → Secrets and variables → Actions** 配置现有签名材料。不要把密钥或密码写入聊天、源码、日志或发布说明。

macOS Secrets：`MAC_CSC_LINK`、`MAC_CSC_KEY_PASSWORD`、`APPLE_API_KEY_BASE64`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`、`TOKEN_MONITOR_APP_PROVISIONING_PROFILE_BASE64`、`TOKEN_MONITOR_WIDGET_PROVISIONING_PROFILE_BASE64`。

macOS Variables：`TOKEN_MONITOR_APP_GROUP`、`TOKEN_MONITOR_WIDGET_BUNDLE_ID`、`TOKEN_MONITOR_WIDGET_KIND`、`DEVELOPMENT_TEAM`。这些值必须与已有 Apple Developer ID、Widget、App Group 和 provisioning profiles 一致。

Windows Secret：`SIGNPATH_API_TOKEN`。当前继承的工作流使用 SignPath 项目 `token-monitor`、组织 `8bf2856b-5fb0-4c78-ba99-90931fcce837` 及 `release-signing` 策略。fork 必须获得该组织 / 项目的明确授权，或由维护者配置自己已授权的组织和 artifact configurations 后再发布。现有 `SignPath Foundation` 签名身份、时间戳和内容校验不能通过去掉检查绕过。具体流程见 [code-signing.md](code-signing.md)。

缺少上述配置时，完整桌面正式发布会阻止。Android 仓库的签名与此分支独立，已有 Android keystore 不能用于签署 macOS 或 Windows。

桌面安装包的发布和应用内更新源均为此 fork；原作者与 MIT 版权保持不变。新的在线会话功能还需按[部署指南](session-conversations.md)在 Hub 和来源端分别启用。
