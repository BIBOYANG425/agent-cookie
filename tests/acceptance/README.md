# 验收骨架 · v0.3

这里登记 A01–A22，共 22 个 `it.todo`。**当前没有业务断言，没有通过的验收项。** Vitest 的成功退出只证明它能收集这些待办，不表示 P0 可演示。

编号、标题和范围来自 `origin/devin/1792265075-plan-v0.3:docs/plan.md` 的“验收清单”，读取时提交为 `f23abfbc26c743aef1e4d634132c0e9ddd01d4a5`。本轮已与合入的本地 v0.3 逐条核对，22 项编号和标题一致。

- P0：A01–A12、A17、A18、A22，共 15 项。
- P1：A13–A16、A19–A21，共 7 项。
- A10、A17：必须在真实客户端手动执行，证据见 [docs/evidence](../../docs/evidence/README.md)。待办不会因模板存在而改成通过。
- A15、A16：保留 HTTP 验收待办；另外准备真实 ACME / coding agent 运行证据。证据模板不能替代将来的断言。

## 独立运行

根 workspace 目前尚未纳入 tests/acceptance，本目录继续独立运行。锁文件只写在本目录，不改根锁。

```sh
cd tests/acceptance
pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts --store-dir .pnpm-store
pnpm --ignore-workspace test
```

依赖固定在本目录的 `package.json` / `pnpm-lock.yaml`；临时独立 store `.pnpm-store/` 已忽略，不提交。项目目标环境是 Node 22；每次运行应记录实际 Node、包管理器版本及命令输出。结果记录在 [scaffold-verification.md](../../docs/evidence/scaffold-verification.md)。

## 将待办替换为真实验收时

只经工作台 HTTP 观察行为，不导入 `packages/core` 或工作台内部实现，不读取 SQLite 或 git 记忆库，也不以内部 mock 代替验收。鉴权使用实际钥匙，不能信任模型传入的 userId / agentId / purpose。请求和响应载荷等契约由 A 线冻结后再写；目前没有臆造请求 body。

工作台应监听 `127.0.0.1:4310`，客户端读取 `AGENT_COOKIE_URL` / `AGENT_COOKIE_KEY`。测试专用环境变量要设置在**工作台进程**上：

| 环境变量 | 用途 |
| --- | --- |
| `AGENT_COOKIE_TEST=1` | A06 开放 `POST /test/clock`；未开启时该路由不存在 |
| `AGENT_COOKIE_DEMO=1` | A12、A22 开放 `POST /demo/reset`；只重置演示 fixture 数据 |
| `AGENT_COOKIE_UCP=fixture` | A09 和可重复的 UCP 路径读取真实录制响应 |

A06 使用契约已有的 `{ offsetMs }`，把服务端时钟拨到授权 `expiresAt` 之后，随后读取必须返回 `403 GRANT_EXPIRED`。清理阶段将偏移还原为 0，不用 sleep 等 10 分钟，不通过更改本机时钟测试。

A22 应保留“重置前第一次 ID”作为基线：同一用户 → 个人 agent A → 同一商家；再经个人 agent B → 同一商家；执行 `POST /demo/reset` 后再介绍到该商家。三个结果都应相同。保持用户种子密钥稳定，商家使用 `merchantKey = domain ?? agentId`（UCP 用 `domain`）；握手和字段里均不得出现电话、邮箱等全局标识。全过程只通过已冻结的 HTTP 接口安排和观察，不读取密钥或 session 推导内部实现。

## 后续根 pnpm 集成

根配置由对应负责人集成，本目录不代改。需要根 `pnpm-workspace.yaml` 纳入 `tests/acceptance`，根测试命令调本包的 `test`，并统一 Node 22、Vitest 版本及根 pnpm 锁。集成时由根负责人将这里的临时独立 pnpm 锁并入根锁，避免双锁长期存在；在此之前使用上面的独立命令。

接入真实测试还依赖：A 线冻结 HTTP 请求/响应契约、提供 fake / 运行中的工作台、测试专用 clock/reset 和稳定用户种子；B 线提供 MCP/Photon 真实客户端运行路径。所有 todo 都必须逐项实施并留证据后才能计为通过。
