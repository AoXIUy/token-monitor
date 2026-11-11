# 此分支的正式桌面发布

发布仓库和应用内更新源均为 `AoXIUy/token-monitor`。此分支仅发布 Windows x64 安装版 / 便携版和 Linux amd64 `.deb`。原作者与 MIT 版权保持不变。

发布源码必须通过 `npm run verify`，并有匹配的稳定版本 `package.json`、锁文件和 `docs/releases/<version>.md`。从 **Actions → Release → Run workflow → main** 手动发布，或推送 `v<version>` 标签，每次只选一种方式。手动发布按源码版本创建标签；已有标签必须指向当前源码提交。不要移动已发布标签或覆盖公开附件；新源码使用新版本。

工作流先在 Node 22 / 24 执行完整校验，然后在 Windows / Ubuntu runner 打包。发布前检查 Windows 未签名状态、Debian 包名 / 版本 / amd64 架构、打包内的更新仓库和更新元数据引用。它生成 `SHA256SUMS` 与记录源码 SHA、平台和 Windows 签名状态的 `release-metadata.json`，先上传到草稿，确认所有附件上传完整后才公开并标记 latest。已公开的版本拒绝再次发布；仅允许相同源码的草稿恢复上传。

## Windows 签名与更新

维护者已选择发布未签名的 Windows 包。此流程不需要 Apple、SignPath 或代码签名 Secrets；不使用上游组织的签名权限。Windows 可能提示“未知发布者”。`build.win.verifyUpdateCodeSignature` 明确设为 `false`，打包的更新配置不声明签名发布者。安装版从本仓库通过 HTTPS 下载更新，并执行更新元数据的 SHA-512 完整性校验，但不执行 Authenticode 发布者验证。便携版通过“查看 release”手动更新。

未来切换到已签名发布，需要先取得自己有权限使用的代码签名身份，再恢复对应的构建 / 发布者验证并发布新版本。仓库保留的 SignPath 辅助脚本和配置是上游实现参考，不代表此 fork 已获得其签名授权。下载检查见 [code-signing.md](code-signing.md)。

## Linux Debian 包

运行 `npm run dist:linux` 构建 `Token-Monitor-<version>-amd64.deb`；维护者字段使用仓库维护者的 GitHub noreply 地址。下载后用 `sudo apt install ./Token-Monitor-<version>-amd64.deb` 安装。应用检查本仓库的 `latest-linux.yml`，通过“查看 release”下载更新并重新安装。此流程不发布 AppImage、macOS 或其他架构。

发布后下载公开附件，核对标签、`release-metadata.json` 源码 SHA、`SHA256SUMS`、更新元数据中的 SHA-512 和 Debian 架构。下载和静态校验不代表已经在真实 Windows / Debian 桌面上完成交互验收。

Android 仓库的签名和发布流程独立。新的在线会话功能还需按[部署指南](session-conversations.md)在 Hub 和来源端分别启用。
