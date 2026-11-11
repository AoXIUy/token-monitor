# Android 按需查看会话对话

本分支的 Node Hub 支持 Android 客户端按需查看 **Antigravity 和 Codex** 的本机对话。只有来源设备上的常驻采集端在线、连接同一个 Hub 并启用此功能时才能查询。打开会话详情不会自动读取正文；点击「查看对话」「刷新对话」或「加载后续对话」才请求对应的一页。

## 启用

桌面应用打开 **设置 → 多设备同步 → 会话对话查询**。此开关默认开启，在连接 Hub / 本机托管 Hub 模式下显示。关闭后立即停止本机提供对话；作为 Host 时，同时取消正在进行的查询并拒绝 Hub 上的新查询。重新开启立即生效，无需重启。关闭的选择会保存在本机，后续启动仍保持关闭。

桌面应用未保存该选项时，也接受 `TOKEN_MONITOR_SESSION_CONVERSATIONS` 作为初始值；已保存的界面选择优先，因此环境变量 `=1` 不会覆盖用户在设置中关闭的选择。

独立 Node Hub 和常驻无界面 Agent 仍分别默认关闭。在对应进程上设置后重启：

```env
TOKEN_MONITOR_SESSION_CONVERSATIONS=1
```

Hub 可使用 `npm run hub -- --session-conversations`，常驻无界面采集端可使用 `npm run agent -- --session-conversations`。两端需要配置相同的 `TOKEN_MONITOR_SECRET`。一次性采集和 `--dry-run` 不提供查询服务。Cloudflare Worker 目前不实现此扩展；原有统计功能继续兼容。

若桌面应用检测到独立常驻 Agent，需在该 Agent 上启用。Hub 和来源端必须使用此分支的新版本；Android 使用 1.8.0 或更新版本。在 APK 的会话详情中选择在线来源设备，然后点击「查看对话」。同一会话在多个设备上存在时可分别查询，不混合正文。

启用后，持有该 Hub shared secret 的客户端可以请求已上报会话的正文；标题同步开关与此功能独立。使用 HTTPS，或在可信私网内使用显式启用的 HTTP。

## 来源和范围

- Antigravity 读取 `brain/<sessionId>/.system_generated/logs/transcript_full.jsonl`。识别 IDE、CLI、备份、`ANTIGRAVITY_HOME` / `ANTIGRAVITY_DATA_DIR`、`GEMINI_CLI_HOME` 和 CC Switch 私有 `~/.cc-switch/agy/<profile>/antigravity-cli` 根目录。同一步骤被改写时采用最新记录。只有二进制数据库而没有导出日志的会话明确显示正文不可用。
- Codex 读取 `CODEX_HOME` 或 `~/.codex` 内当前及归档 rollout，支持 `.jsonl` 和 `.jsonl.zst`。原生线程 ID 通过本机 catalog 解析并核对日志头。只有 Dots 用量计数而没有 rollout 时，不补造对话。
- 显示用户提问、助手回复及记录在日志中的上下文、可读思考摘要和工具输入 / 输出；工具与上下文默认折叠。图片只显示附件占位，不读取图片文件、加载外部链接或解密不透明推理。
- Windows 的 WSL 查询仅在现有 WSL 扫描开关开启后检查已经运行的发行版；不启动已停止的发行版。
- 仅查询该设备在今日 / 本月快照中实际上报的会话键。对话本身不按统计周期裁剪，也不把父子会话或其他设备的消息拼接在一起。

读取在独立 Worker 中执行，10 秒超时，单个解码日志上限 64 MiB。每页最多 40 个文本片段、384 KiB；长消息分段后可继续加载，保留原文和顺序，不用摘要替换正文。日志改动使原分页游标失效，需要刷新重新读取。无法解析或未写完的记录保留不完整提示。

## 数据边界和故障

来源端保持一个认证的 20 秒长轮询，只接收查询标识，不扫描或上传所有会话正文。查询由 Hub 在内存中转发，12 秒未得到结果就超时；结果交给当前请求后立即移除。断开连接、停止 Hub、删除设备或请求取消都会清理对应请求。设备正文不进入 DeviceRecord、统计、SSE、上传差分、磁盘持久化、用量归档、通知或微件。

APK 只通过受限的原生 GET 接口读取，凭据不进入网页；切换会话 / 设备 / Hub、返回列表或进入后台时清空当前对话并拒绝旧结果。正文按纯文本显示，不执行 HTML，不启用 WebView 直接联网或文件访问。反向代理需允许至少 30 秒的上游请求时间。设备离线、功能未启用、旧 Hub、缺少日志和超时都有明确提示。

格式实现参考 [CC Switch Antigravity reader](https://github.com/farion1231/cc-switch/blob/efbec38f0e1ecaee2a488d619190b7ec4075238b/src-tauri/src/session_manager/providers/agy.rs) 和 [Codex reader](https://github.com/farion1231/cc-switch/blob/efbec38f0e1ecaee2a488d619190b7ec4075238b/src-tauri/src/session_manager/providers/codex.rs)。本实现没有引入 CC Switch 运行时依赖，也不读取其账户凭据。
