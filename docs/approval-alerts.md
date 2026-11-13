# 审批提醒（Codex / Antigravity）

本分支的 Node Hub 支持将本机 **Codex**（`PermissionRequest` hook）和 **Antigravity**（`PreToolUse` hook）的需要确认事件仅在内存中转为只读提醒并推送给在线 Android 客户端（通知栏弹窗 + App 只读提醒卡）。

桌面侧不会等待手机端确认；手机端也**不再提供允许/拒绝回传接口**，所有允许或拒绝操作均保持在电脑端完成。

该功能与[在线会话对话](session-conversations.md)同样属于 Node Hub 可选扩展，Cloudflare Worker 不实现此接口。

## 启用与安装

默认全部关闭，需要在 **Hub、来源端、Android** 三端分别开启：

1. **Hub 端：**
   - 桌面 Host 模式：打开 **设置 → 多设备同步 → 审批提醒（Codex / Antigravity）**。
   - 独立 Node Hub：设置 `TOKEN_MONITOR_APPROVAL_ALERTS=1` 或启动参数 `npm run hub -- --approval-alerts`。
2. **来源设备（运行 Codex / Antigravity 的电脑）：**
   - 桌面端（Host 或 Client 模式）：在 **设置 → 多设备同步** 中打开 **审批提醒**，并点击 **Codex Hook / Antigravity Hook** 旁的 **安装 Hook**。
   - 无界面常驻 Agent：设置 `TOKEN_MONITOR_APPROVAL_ALERTS=1` 或启动参数 `npm run agent -- --approval-alerts`（`--once` 和 `--dry-run` 不启动本地 IPC 桥）。
   - 安装的 hook 入口写入用户配置：
     - Codex：`${CODEX_HOME:-~/.codex}/hooks.json`（`PermissionRequest`）
     - Antigravity：`~/.gemini/config/hooks.json`（`token-monitor-approval-alert` → `PreToolUse`）
   - **Codex 信任要求：** 安装 Codex hook 后，需在 Codex CLI 中运行 `/hooks` 审查并信任该 hook，否则 Codex 会跳过执行。
3. **Android 端：**
   - 在 **完成提醒 / 审批提醒** 设置卡片中打开 **审批提醒（只读）** 开关。

## 行为与语义

- **桌面零阻塞：** 本机 hook 通过受权限保护的本地 IPC 将事件异步提交给常驻客户端后立即返回桌面原生行为（Codex 空输出退出，直接进入原生审批；Antigravity 返回 `{"decision":"ask"}`），绝不阻塞会话等待手机响应。
- **Antigravity 匹配规则说明：** Antigravity 目前仅支持 `PreToolUse` 事件，默认只匹配 `run_command`（可在桌面设置中修改）。当安装并启用时，匹配的 Antigravity 工具调用会触发手机提醒并在桌面按 `ask` + Always-Allow 缓存询问确认。
- **有界内存与去重：** Hub 仅在内存中保留每条提醒 **2 分钟**（上限全局 32 条 / 每设备 8 条，超限按 FIFO 淘汰）。Android 端每 5 秒只读拉取 `GET /api/approval-alerts` 并按提醒 `id` 本地去重，确保每条只通知一次且划掉后不会重复弹出。

## 数据边界与安全说明

- **严格只读 Android 客户端：** Android 端只允许 `GET /api/approval-alerts`，没有任何允许/拒绝决策接口或写入能力。
- **内存转发：** 提醒内容（命令最多 4000 字符、工具名、会话 ID、项目文件夹名，不含完整本地路径）仅在 Hub 内存中保存 2 分钟，不写入 `devices.json`、统计、SSE、历史归档或 DeviceRecord。
- **本地 IPC 隔离：** 本机 hook 通过受权限保护的本地端点（Unix domain socket `0600` 或按用户目录散列命名的 Windows 管道）与随附 32 字节随机令牌文件 `approval-bridge.json`（`0600`）连接常驻桥接进程。
