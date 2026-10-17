# Agent Cookie MCP — B 线脚手架与接线说明

当前入口是个人 agent 的 stdio MCP。启动时通过 B 线 SDK 调 `/me`，只有服务端返回 `role=personal` 才注册 `get_my_card`。每次工具调用重新请求 `/personal/card`，不缓存之前的读取结果。错误不含原始响应或密钥，stdout 只写 MCP 协议帧。

## 本地安装、验证

使用 Node 22.12 以上的 22.x。根工作区尚未合入，先按 `../sdk/README.md` 安装、构建 SDK，再从仓库根运行：

```sh
pnpm --dir packages/mcp install --ignore-workspace --ignore-scripts
pnpm --dir packages/mcp typecheck
pnpm --dir packages/mcp test
pnpm --dir packages/mcp build
pnpm --dir packages/mcp check
```

`check` 只校验本地配置，不访问网络；`workspaceVerified:false` 是明确的未验证状态。把本目录 `env.example` 复制为 `.env` 后，在本机填入 `AGENT_COOKIE_KEY`。默认 `AGENT_COOKIE_URL=http://127.0.0.1:4310`。不要把密钥放进共享文档。

测试包括真实 MCP 客户端的工具发现、错误响应，以及一条完整的 **stdio 子进程 → 生产 MCP 入口 → SDK → 临时 Sample HTTP 服务** 链路。该临时服务只在测试内监听随机 loopback 端口，结束即关闭；不冒充 A 线假工作台，不提供策略或数据库。测试拒绝下一次读取以确认没有返回缓存卡片。

## Claude Desktop 配置示例

先确认 A 线工作台已启动，并颁发了可调用 `/me` 与 `/personal/card` 的个人 key。下面是待接入的 `claude_desktop_config.json` 片段，不会由脚手架自动修改全局配置：

```json
{
  "mcpServers": {
    "agent-cookie": {
      "command": "/absolute/path/to/node22",
      "args": [
        "--env-file=/absolute/path/to/agent-cookie/packages/mcp/.env",
        "/absolute/path/to/agent-cookie/packages/mcp/dist/main.js"
      ]
    }
  }
}
```

路径须替换为本机绝对路径；在已有 `mcpServers` 中添加该项，保留其他服务。按 [MCP 官方本地接入说明](https://modelcontextprotocol.io/docs/develop/connect-local-servers) 从 Claude Desktop 的开发者设置编辑配置，完全退出后重新打开。

连接成功后请求：“调用 get_my_card，显示我的语言、说话方式和鞋码，并保留 Sample 标签。”只有真实 Claude Desktop 调用及工作台日志都可见，才算真实客户端接通；这里的自动测试不计作 A10。A10 还要求 `find_agents`，本轮未实现。

## 当前边界与交接

- 已实现：SDK 读卡、personal 角色检查、单个工具、stdio、环境检查、Sample 集成测试。
- 尚未实现：其余 personal 工具、merchant 工具、4311 streamable HTTP、购物主流程、实际 Claude Desktop 接入。
- 等待 A 线：合入根工作区与冻结 core 类型，启动假/真实工作台，提供个人测试 key 的本地配置路径。
- 下一步 B 线：按冻结契约继续扩展 SDK/CLI/MCP；不要在这里实现合并、权限或数据库。

SDK 所有权已按 v0.3 改为 B；工作台和核心规则仍属于 A。跨线缺口只追加到 `docs/requests.md`。
