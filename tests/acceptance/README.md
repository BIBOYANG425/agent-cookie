# 历史 HTTP 验收 · v0.3

> 2026-10-17 范围调整：P0 自动项统一由 A 线的 `apps/workspace/test/acceptance` 推进，用户确认该套件已执行 66/66。C 不再扩写本目录的重复测试；现有代码和以下结果保留为历史记录。C14 当前工作是 A15/A16 手动证据及 A10/A17 的 B 线证据索引，见 [证据索引](../../docs/evidence/README.md)。不要用本目录的旧 todo 数量判断当前 P0 状态。

本次调整按用户最新要求检查结果性质，不再要求固定商品、固定尺码或固定预算。现有 22 个编号、标题和 TODO 状态保持不变，也不复制 A 线的 66 项。历史套件的期望由当前 HTTP card 和本次 intent 导出；`87.65`、`64.30` 及合并测试数值是受控输入，不是产品约束。A22 的商品类别从稳定 Sample 商家的 fixture capability 读取。

`properties.ts` 提供可复用检查：

- 按商家身份去重后最多两家，允许零家或一家；不强制凑齐两家。
- 报价使用整数 cents，与本次 intent 优先、当前 card 兜底的预算比较；未知价格和不同货币不能算已验证预算。
- 尺码按真实目录标签检查。当前 Quote 没有结构化尺码或错配字段，调用者必须提供真实目录尺码与实际用户可见说明；没有同标签尺码时，说明须提到用户尺码和可用目录尺码。不推断不同尺码制式等价。
- A05 经 HTTP 验证 accept 前无地址放行；在受控 callback 路线 accept 后，再显式读取 checkout 地址，只有被选商家成功、另一家被拒，对应回执只属于被选商家/session。blocked、failed 或 handoff 结果本身不要求产生地址回执。live 模式必须拒绝 Sample 地址；本次 fixture 模式不证明这一独立 live 边界，也不证明真实 UCP checkout。

这四个 helper 用例只验证证据检查工具，不属于 A01–A22 新增通过项。Sample callback 没有真实商品、LLM 或 UCP；普通商家 HTTP 报价即使返回 `source=live`，也不能独立证明真实 UCP 来源。当前工作台仅对 UCP 选择限制两家和预算；普通 callback/Tier0 匹配没有同样的全局数量限制，商家提交报价端点也不拒绝超预算。本目录结果性质检查不能代替这些后端约束。

2026-10-17 本次复测：**12 个历史执行项 + 4 个 helper 用例通过，11 todo 保持不变**；随后新增的 A05 accept 前地址拒绝 / 零地址回执断言单独复跑通过，typecheck 通过。后台使用外部原版 main `8c1a869`、其 rules/memory/ucp 接线和 `AGENT_COOKIE_UCP=fixture`，专用地址为 `http://127.0.0.1:4328`，全新数据与 fixture 副本位于 `/private/tmp/agent-cookie-acceptance-2fjiweia`。本次完整 JSON 结果是该目录的 `results-final.json`（临时文件，不替换历史 C14 证据）。未重置 4310、5173 或 4318 的现有服务。A11 适配了当前 merchant 回复不暴露 userId；A13 以 accept 后实际 grant 数量为基线，并检查重复 accept 不增加 grant。

## 历史 C14 记录

C14 实现其中 11 项 HTTP 测试：A01–A08、A11、A13、A22；另有 1 项独立 reset 支撑检查。**当时实际结果为 12 passed / 11 todo，不代表 P0 全绿或完整 demo 已通过。**

编号、标题来自本地 `docs/plan.md` v0.3；HTTP 请求和响应对照 A 线 `bd9d6e3` 的 `apps/workspace/src/app.ts`、services 和 contract。实际运行与适配器边界见 [C14 HTTP 证据](../../docs/evidence/C14-http-acceptance.md)，机器结果见 [C14-http-results.json](../../docs/evidence/C14-http-results.json)。原 [scaffold-verification.md](../../docs/evidence/scaffold-verification.md) 是先前 22 todo 阶段的历史证据。

- P0：A01–A12、A17、A18、A22，共 15 项。本轮其中 10 项 HTTP 测试通过；A09、A10、A12、A17、A18 仍 todo。
- P1：A13–A16、A19–A21，共 7 项。本轮仅 A13 HTTP 测试通过。
- A03 的 HTTP 检查证明 ID 不同、跨商家读取拒绝且不暴露 session 是否存在；密码学不可逆性需要独立算法审查，不能由两个不同字符串证明。
- A09 必须接真实录制的 UCP catalog fixture；内存 Sample offers 不算。目录变体必须与本次 intent / 当前 card 的实际尺码核对，尺码不同或无法核实时需用户可见说明。
- A12 仍要求完整 demo 重跑。末尾的 Sample callback 流程重放只证明 HTTP reset 行为，单独列项，未把 A12 改绿。
- A10、A17 仍需真实 Claude Desktop / iMessage 证据；A14 仍需真实控制台视图；A15、A16 仍需各自原标准的真实模型 / skill 运行。
- A18 需要可追溯的售罄和 escalation 响应及用户可见告知。`UCP_STUB_COMPLETE` 模拟不会使它通过。A19–A21 的真实 D 线能力仍 todo。

## 独立运行

运行前请由工作台负责人启动隔离的 Sample 工作台。测试会调用 `/demo/reset`、注册临时商家、写 Sample 贡献与 note、接受本地 Sample 报价并调整测试时钟；不要与演示、控制台手工测试或另一套验收并行。

目标环境 Node 22，依赖保持本目录独立锁定：

```sh
cd tests/acceptance
pnpm install --ignore-workspace --frozen-lockfile --ignore-scripts --store-dir .pnpm-store
pnpm --ignore-workspace typecheck
AGENT_COOKIE_URL=http://127.0.0.1:4328 pnpm --ignore-workspace test
```

已有依赖时也可直接用 Node 22，不经过 pnpm/corepack：

```sh
cd tests/acceptance
AGENT_COOKIE_URL=http://127.0.0.1:4328 node node_modules/vitest/vitest.mjs run --config vitest.config.mjs
```

测试进程必须显式配置 `AGENT_COOKIE_URL`，没有默认 reset 目标；仅接受 loopback HTTP 地址，仍须由操作者确认它是专用可重置实例。**不需要 `AGENT_COOKIE_KEY`**：测试从仓库 `fixtures/dev-keys.json` 读取 Sample owner、两个 personal 和 Sample ACME 的角色绑定，服务必须装载相同绑定。注册返回的新钥匙仅留在内存中，不写日志或证据。

纯性质检查无需工作台、钥匙或 URL：`node node_modules/vitest/vitest.mjs run --config vitest.config.mjs properties.test.ts`。

## 外部工作台前提

本套件不导入或启动工作台，不读 SQLite 或 git 记忆库。它只通过 HTTP 观察；测试自身会在 `127.0.0.1` 随机空闲端口启动无模型 callback 收件器，作为临时 Sample 商家。

以下变量设置在**工作台进程**，不是测试进程：

| 环境变量 | 必需设置与用途 |
| --- | --- |
| `AGENT_COOKIE_DEMO=1` | 开放 owner-only `/demo/reset`，装载 Sample dev keys |
| `AGENT_COOKIE_TEST=1` | 开放 `/test/clock { offsetMs }` |
| `AGENT_COOKIE_UCP=fixture` | A22 使用 seed capability 时不触发 live UCP；此变量本身不能证明真实录制 adapter 已装载 |
| `FIXTURES_DIR` | 隔离 fixture 副本，保留仓库的 users、贡献、agentId 和 dev-key 绑定 |
| `AGENT_COOKIE_DATA_DIR` | 独立临时运行目录，避免重置其他演示状态 |
| `MEMORY_REPO_PATH` | 独立临时记忆目录；本套件不读取它 |
| `PORT` / `AGENT_COOKIE_URL` | 例如独立的 `4328` / `http://127.0.0.1:4328`，与测试 URL 对齐 |

A22 使用 seed 中稳定的 `sample-acme`。外部临时 fixture 应移除它原有的真实 chat endpoint，改为一个无模型、仅返回 2xx 的 loopback `callbackUrl`，保持原 `agentId` 和 capability。不能同时移除两个入口：当前 A 源码会跳过没有 callback/chat endpoint 的商家，导致没有 session。历史 C14 sink 是 `http://127.0.0.1:4359/callback`，只返回 204、不记录载荷、不调用模型；后续运行可用随机空闲端口。测试不接受该路线的任何 UCP 报价，不会发真实 checkout 或付款请求。

当前 A 实现启动时读取 fixtures，`/demo/reset` 重用该快照；修改临时 fixture 后须重启工作台。A22 保留 reset 前第一次 session ID，经过第二个 personal，再 reset，再比较该基线；note 在换 personal 后仍可读，reset 后须清空。

A06 先从 `/test/clock` 响应读取服务端时间，再计算超过握手 `expiresAt` 的偏移。`finally` 和每项测试后的清理都恢复 `offsetMs=0`，不靠客户端伪造时间或等待十分钟。

## 报告

可另存新的运行报告，保留历史结果：

```sh
AGENT_COOKIE_URL=http://127.0.0.1:4328 node node_modules/vitest/vitest.mjs run --config vitest.config.mjs \
  --reporter=verbose --reporter=json --outputFile.json=/absolute/path/to/new-http-results.json
```

成功退出仅说明已实现断言通过，todo 不会使退出码失败。应同时报告已执行的编号、todo、工作台来源提交和真实装载的 adapter。历史 C14 工作台的 HTTP / SQLite 服务来自 A 原版源码，但 RulesApi、MemoryRepoApi、UcpApi 当时使用它的 stubs；历史报告不证明 C 的 rules/memory 包或 D 的 UCP 包已集成。

历史强化复测使用 4318，避免重置 C10b 的 4310 后台。A05 检查接受前后用途及冲突 card budget；A22 要求每次介绍新增 grant；reset 支撑检查先通过 checkout 地址读取产生非空回执。auto 字段读取回执不在本目录已满足的能力声明中。
