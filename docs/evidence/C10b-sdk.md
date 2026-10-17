# C10b · SDK 与真实工作台连接

2026-10-17 14:08 America/Los_Angeles，控制台本机服务 `127.0.0.1:5173` 已通过 B SDK 和明确的缺方法 HTTP 适配连接 `127.0.0.1:4310`。原始检查结果见 [C10b-sdk-results.json](C10b-sdk-results.json)。本项验证的是接口接线，**不是完整 P0 验收**。

## 调用与钥匙

- 控制台服务读取环境 `AGENT_COOKIE_KEY`；浏览器不再接收或输入钥匙。不存在 `VITE_*` 秘钥替代。
- `getMe/getMyCard/getReceipts/getActivity` 加载实际 `@agent-cookie/sdk` `WorkspaceClient`。
- `getGrants/revokeGrant/revokeContribution/demoReset` 在 B `fd1b8d4` 不存在，使用 `server/workspace.ts` 的 `TODO(sdk)` 分支；SDK 方法若抛错不会触发 HTTP 重试。补齐 SDK 后无需修改路由即会优先选对应方法。
- 完整方法清单已追加到 `docs/requests.md`，详细返回契约和运行说明见 [console README](../../apps/console/README.md)。
- 服务端要求 owner、固定上游和端点白名单，并核对请求 Host、Origin、console 标记。真实跨 Origin 请求返回 403；错误响应不含原始异常内容。
- `AGENT_COOKIE_SAMPLE=1` 保留 Sample 标识；不是授权开关。构建产物和实际桥接响应扫描均未包含本次 owner key。

## 实际运行环境

- Node 22.23.3；pnpm 10.32.1；Vitest 2.1.9。
- A 工作台 `bd9d6e3`、B SDK `fd1b8d4`，均从远端分支导出到仓库外 `/private/tmp/agent-cookie-c10b-runtime-rq8escjo`；A 63 个文件、B 8 个文件逐字节与远端一致。
- SDK 已构建到该目录 `node_modules/@agent-cookie/sdk/dist/index.js`；控制台 `AGENT_COOKIE_SDK_ROOT` 指向该临时根。代码没有复制到 C 目录或提前合入 A/B 分支。
- A 原版 Sample fixtures、隔离 SQLite 数据目录，`AGENT_COOKIE_DEMO=1`、`AGENT_COOKIE_TEST=1`。A 的 rules/memory/UCP 适配器仍为桩；本结果不证明真实 git 或 UCP checkout。
- A 自带种子身份卡为 5 条，与 C 的 3 条 fixture 是不同 Sample 数据集，不能混称为同一次验收。

## 检查结果

17 个控制台测试全部通过（12 adapter/controller + 5 服务端桥接）。类型检查、生产构建和离线 frozen-lockfile 安装通过。桥接测试覆盖真实 Node HTTP listener、SDK 方法选择、缺方法回退、SDK 失败不重试、owner 校验、重定向拒绝、跨站/Host 拒绝和 Sample 元数据。

实际请求均经过正在运行的 Vite 服务：

1. `GET /me` 识别 owner；card/grants/receipts/activity 返回 200，card 带 Sample 标记。
2. 用实际 B SDK 的个人角色创建 Sample intent，随后从控制台桥接读到 3 条授权；撤销其中一条，再读取确认为 revoked。
3. 用已知 A fixture contribution ID 调用来源撤销，返回 `{ ok: true, card }`。这不补齐 A14：UI 仍缺贡献 ID 列表，不能从来源 agent ID 猜出记录 ID。
4. `POST /demo/reset` 返回成功；card 恢复为操作前的 5 条种子，grants 清空。
5. 带外站 Origin 的 reset 请求返回 403，未执行写入。

浏览器工具拒绝了本轮打开本机页的操作（URL 安全策略），未尝试绕过。因此没有新的 C10b UI 截图；C09/C10/C16 的历史界面证据保留，不能冒充新传输的浏览器复核。后端可达性由上述实际网络调用验证。

初次服务端测试在普通沙箱因 loopback listener `EPERM` 失败；使用获准的测试环境后通过。Sample 元数据测试首次漏写嵌套 card 元数据预期，修正预期后 17/17 通过；没有删除失败断言或跳过测试。
