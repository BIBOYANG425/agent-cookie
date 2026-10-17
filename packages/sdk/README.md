# Workspace SDK — B 线本地脚手架

基于 `docs/plan.md` v0.3 和 A 线已发布的 HTTP 错误 envelope。当前实现 `new WorkspaceClient({ baseUrl, key })`、`getMe()`、`getMyCard()`，供 CLI 和 MCP 共用。身份、字段策略、合并、过期和撤销仍由 A 线工作台处理。

本轮范围是本地读卡骨架。尚未实现 intent、quote、checkout、merchant API、写入与 reset。卡片内部类型暂为 `unknown`，只检查 `{ card: [], candidates: [] }` 外层；A 线 core 正式合入后引用其类型，不维护另一套业务类型。

## 安装与检查

使用 Node 22.12 以上的 22.x 和 pnpm。在仓库根运行：

```sh
pnpm --dir packages/sdk install --ignore-workspace --ignore-scripts
pnpm --dir packages/sdk typecheck
pnpm --dir packages/sdk test
pnpm --dir packages/sdk build
```

根工作区尚未合入时，B 线各包使用自己的锁文件。CLI/MCP 暂以 `link:../sdk` 引用本地 SDK，先构建 SDK。根工作区合入时应由根文件 owner 统一锁文件与安装流程；不要把这些临时独立安装步骤当成整仓启动命令。

```ts
import { WorkspaceClient, workspaceConfigFromEnv } from '@agent-cookie/sdk';

const workspace = new WorkspaceClient(workspaceConfigFromEnv(process.env));
const identity = await workspace.getMe();
const card = await workspace.getMyCard();
```

`AGENT_COOKIE_URL` 默认 `http://127.0.0.1:4310`，`AGENT_COOKIE_KEY` 必填。只接受无路径、无内嵌凭据的 loopback HTTP origin。每次请求携带 Bearer key，不缓存卡片、不跟随重定向、不自动重试；默认 25 秒超时。`timeoutMs` 和 `fetch` 构造参数用于有界调用及测试注入。

已识别的服务端拒绝抛 `WorkspaceError { status, code, message }`，message 使用不含私密字段的固定文案。网络、超时、格式不符或未知错误使用固定消息的普通 Error；不附原始响应、请求头或 cause。SDK 不打印任何数据。

测试使用明确的 Sample 响应，覆盖逐次鉴权、撤销后的下一次读取、重定向、超时、不重试和错误脱敏；不代表真实工作台已经验收。
