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
# 动态学习的性质证据（C20）

`learning-properties.test.ts` 只验证响应观察的性质：正式分组载荷投影、独立来源去重、短证据、暂停后无新记录、撤销与受控候选集的偏好排序；这些小测试不是模型或工作台集成通过证据。受控结论使用 A 白名单中的 `pref.style`、`pref.material`，不把不存在的防水字段当成正式契约。排序比较必须使用相同合格候选集，预算/尺码等其他因素相同，命中属性来自真实 catalog，不能按商品名猜。

`learning-http.test.ts` 只打 HTTP，默认跳过；B 实际跑完演示对话后，以显式的隔离工作台和 owner key 启用：

```sh
AGENT_COOKIE_LEARNING_TEST=1 AGENT_COOKIE_URL=http://127.0.0.1:4310 \
  pnpm exec vitest run --config vitest.config.mjs learning-http.test.ts
```

钥匙由当前进程环境 `AGENT_COOKIE_KEY` 传入，不写进命令、证据或浏览器。已按 A `0129f08` 的正式 `GET /personal/learned` 载荷 `{ paused, learned: [{ field, value, status: 'card' | 'candidate', sources: agentId[], evidence: [{ contributionId, agentId, basis, createdAt, intentId?, conversationId?, snippet? }] }] }` 投影，拒绝旧桩 `{ enabled, entries }`。`sources` 中的作者不能当成两个独立对话；同一 evidence 的 intent/conversation 标识是别名，部分副本及传递别名只计一次。已知撤销/过期记录保留身份连接，但不能作为晋升支持；本次 GET 不返回已撤销历史时，单次快照无法证明服务端保留了所有历史别名。

C20 仍要求非空结论、非空真实短摘句和来源，再检查单来源候选、明确 stated 或双独立来源晋升，以及未来、过期和 200 Unicode 字符边界。服务 200、已排队、手工注入贡献或 Sample fixture 都不等于实际对话学习成功；本测试也不能仅凭最终响应独立证明模型调用，必须同时保留实际对话与提取链路证据。端点 404、空 learned 或证据缺失不能变成 C20 通过。

可单独设置 `AGENT_COOKIE_LEARNING_CONTRACT_TEST=1` 执行同文件的只读契约 smoke：它读取 `GET /personal/learning` 和 `GET /personal/learned`，允许 `{ paused: false, learned: [] }`。这只证明路由和载荷可读，明确不计为 C20。两组测试默认均跳过；不新增 learn 写端点，不直接读 SQLite/git，不复制 A 的 P0 套件。真实执行状态见 [learning.md](../../docs/evidence/learning.md)。


`learning-backend-probe.mjs` 是另一个明确开启的 HTTP-only 记录器：先检查 owner/personal 角色，验证暂停并恢复原值，以本次唯一 Sample 值演练贡献/撤销，然后投递用户指定的两句对话。只有专用实例才能设置 `AGENT_COOKIE_ISOLATED_PROBE=1`；owner/personal key 分别从 `AGENT_COOKIE_KEY`、`AGENT_COOKIE_PERSONAL_KEY` 传入，不写入参数或输出。未知写入结果会查回真实贡献ID尝试撤销；无法确认时报告 unconfirmed 并失败。可选 `AGENT_COOKIE_C20_QUERY` 只触发一次真实 catalog 基线，不接受报价/付款。无本次预算时不套用固定价格上限。

```sh
AGENT_COOKIE_ISOLATED_PROBE=1 AGENT_COOKIE_URL=http://127.0.0.1:4310 \
  node learning-backend-probe.mjs > /absolute/path/to/new-learning-http.json
```

它明确返回 `automaticLearningVerified:false`、`rankingEffectVerified:false`，用于记录实际接线和基线，不能替代B真实模型、个人agent通道和排序证据。人工贡献与两条排队消息不构成C20成功。只读契约验证请限定 `learning-http.test.ts`，不要运行带URL的整个历史套件：后者会reset且要求 `AGENT_COOKIE_TEST=1`。

## A23 stock memory 格式互操作（独立 opt-in）

用户对 A23(c,d) 明确授权 **git + HTTP**；这是本目录原 HTTP-only 规则的限范围例外。`memory-interop.test.ts` 不导入 workspace、contract、SDK、rules 或 SQLite，不调用模型，也不运行第三方 skill。它以 `Synthetic A23 ordinary agent` 作者在指定独立记忆库提交普通 Markdown、SQL 文件及 `MEMORY.md` Index，用于自动互操作支撑。真实 Claude stock skill 写入／跨会话回读由单独的实录验收，不能由这两个测试代替。

规范按上游 [SPEC.md](https://github.com/AgentMemoryRepo/agentmemoryrepo/blob/main/SPEC.md) 与 [stock skill](https://github.com/AgentMemoryRepo/agentmemoryrepo/blob/main/skills/agent-memory-repo/SKILL.md) 核对：记忆库独立于项目；写前必须干净；先读 `MEMORY.md`；普通文件可自由组织；`## Index` 的 `[[path]]` 从根解析，Markdown 省略 `.md`，SQL 保留扩展名。测试仅 stage 本次改动的三个文件，不配置远端、不推送、不执行记忆中的脚本，也不主动 checkout、clean 或改写历史。

两个集成项默认跳过：

- **A23(c)**：Synthetic 普通提交后，通过既有 HTTP 端点写贡献、确认 CARD 再生成；注册现有 `retail` 类别的 inert callback 商家，提交 Sample 报价并返回 handoff，accept 后按 `checkout` 读取 Sample 地址产生回执，再写／读 note。确认四个自管路径实际发生变化、普通文件保留、Index 可解析，git log 同时保有 Synthetic 作者与后续 workspace 提交。无真实商品、UCP、付款或 stock skill 成功声明。
- **A23(d)**：只有 (c) 全部完成并确认 HTTP 写入了所指定的记忆库后，才执行 `POST /demo/reset`。普通文件、`MEMORY.md` 修改和原提交应保留；`contributions/`、`notes/`、`CARD.md`、`receipts.md` 的受跟踪内容及未跟踪文件严格对比 `fixtures-seed`。A reset 后 reconcile 产生的地址／CARD 差异也会失败，不算作相等。

运行前由负责人启动全新、专用的 demo 工作台，绑定此 `MEMORY_REPO_PATH`，装载 Sample fixtures，并设置 `AGENT_COOKIE_DEMO=1`、`AGENT_COOKIE_UCP=fixture`。owner 与 personal 钥匙分别通过测试进程的 `AGENT_COOKIE_KEY`、`AGENT_COOKIE_PERSONAL_KEY` 注入；不写进命令或报告。测试拒绝 4310、5173 和真实 stock rehearsal 的 4331。自动验收预留 4332，不能与其他运行共享记忆库。

```sh
cd tests/acceptance
AGENT_COOKIE_A23_TEST=1 AGENT_COOKIE_ISOLATED_PROBE=1 \
  AGENT_COOKIE_URL=http://127.0.0.1:4332 MEMORY_REPO_PATH=/absolute/path/to/dedicated-memory \
  node node_modules/vitest/vitest.mjs run --config vitest.config.mjs memory-interop.test.ts
```

**只运行上面指定的文件**，不要带着该 URL 运行整个历史套件。测试结束保留独立记忆库和提交供检查，afterAll 只关闭测试 callback，不另做 reset。重跑会新增新的 Synthetic 文件与提交，建议每次新建专用数据目录和记忆库。

`memory-interop-safety.test.ts` 的 5 项离线测试覆盖显式 opt-in、保护端口、配置错误不回显凭据、根 wiki 解析和路径逃逸拒绝，无后台访问。2026-10-17 在专用 `127.0.0.1:4332` 实测两文件共 **7 passed**（5 safety + A23(c,d)，2.97 秒），类型检查通过。运行使用隔离 runtime `/private/tmp/agent-cookie-c21-runtime-o056ei5h` 与记忆库 `/private/tmp/agent-cookie-a23-auto-memory-vuee0ba0`；该 runtime 包含本轮未提交的 C memory 修复及同步地址后的 seed，不能归因于未修改的 main。无钥匙日志保存在 `/private/tmp/agent-cookie-a23-results-Yz0j2c/stdout.log`（临时本机证据）。这证明 Synthetic 普通文件与工作台读写／重置互操作，**不证明真实 Claude stock skill 的安装、写入或跨会话回读**。

## A32 助理之间的流失（churn）· 自启专用工作台

`a32-churn.test.ts` 是 `docs/bring-your-own-agent-plan.md` §3 提议的 A32（尚待人加入 `docs/plan.md` §2）。它是本目录“不启动工作台”规则的唯一例外：`a32-workspace.ts` 以子进程启动真实的 `apps/workspace`（其自带 tsx 运行 `src/server.ts`），监听随机空闲的 `127.0.0.1` 端口，使用全新临时数据目录（SQLite 与 git 记忆库）、仓库 `fixtures/` 的 Sample 种子和 `AGENT_COOKIE_DEMO=1 AGENT_COOKIE_UCP=fixture` 录制回放，结束时停止进程并删除目录。测试只通过 HTTP 与它交互，不导入工作台代码，不读 SQLite 或 git，也不重置任何其他实例。它**不需要** `AGENT_COOKIE_URL` 或 `AGENT_COOKIE_KEY`：owner 钥匙按 agentId 与角色从 `fixtures/dev-keys.json` 读取，新注册的钥匙只留在内存中。前提是已在仓库根目录执行 `pnpm install`，`apps/workspace/node_modules/.bin/tsx` 已存在。

```sh
cd tests/acceptance
node node_modules/vitest/vitest.mjs run --config vitest.config.mjs a32-churn.test.ts
```

只运行这个文件。不设 `AGENT_COOKIE_URL` 时，其他历史文件在导入时就会失败。

步骤与断言：

1. 助理 A 注册；owner 批准前读 context 得 403 SCOPE_DENIED。A 请求 link，owner 批准。A 的首次 context 含种子值 `lang`、`tone`、`shoe_size`，不含地址或支付令牌（字段名和值都没有），也不含 `sources`。
2. A 以 `stated` 加 evidence 写入 `shoe_size`（与种子不同的值）和 `pref.brand`，然后建 intent，接受一条 UCP fixture 回放报价（商店 B）。回执里有 A 会话的 `assist`，以及 B 会话对该 intent 的 `checkout`（`shipping_address`）。
3. 助理 C 注册、link、owner 批准。**C 的首次 context 带有 A 写入的两个值**，且不含 A 的 evidence 原话或 conversationId。
4. 商店 D 不走协议：注册为 `shoe`，带唯一 capability 和本测试的 loopback `callbackUrl`。C 的 intent 带 `kind` 提示（HTTP 路由接受已 link 助理传 `kind`；SDK 的 `find()` 目前不传）。D 收到 `introduce` 后读 handshake 与 auto 字段，读到的 `shoe_size` 是 A 写入的值；accept 前按 `checkout` 读地址得 403 PURPOSE_MISMATCH，此时 D 的会话没有回执。D 报价，C 接受（`handoff`），D 收到 `accepted` 后按 `checkout` 读到 Sample 地址，读 `payment_method` 得 403 SCOPE_DENIED。
5. 回执恰好涉及四个会话：A、C（`assist`），B、D（`checkout`）。带地址的回执只有 `checkout`，且只发给 B 或 D；没有任何回执包含 `payment_method`。
6. Funnel 的两行 `createdBy` 分别为 A 和 C；`questionsSkipped` ≥ 1，且等于该 intent 回执字段数之和。各自的 `/assistant/stats` 与之一致。
7. C 读 A 的 intent 报价、接受 A 的另一条报价，均得 404 NOT_FOUND。
8. owner 撤销 A 的 assist grant 后，A 的 context 得 403 GRANT_REVOKED。C 的下一次 context 不再有 `pref.brand`（回到 `unknown`），`shoe_size` 回到种子值。
9. 所有发给助理和商家的响应（含 D 收到的 callback）都不出现 `payment_method` 这个字段名；地址片段只出现在 D 的 checkout 读取里。

计划 §3 写的是“`questionsSkipped` ≥ 每个 intent 的 auto 字段数”。本测试按任务要求断言 ≥ 1，因为商家读 auto 字段（callback 商家和 UCP 代理都一样）不写回执，这两个 intent 的 `questionsSkipped` 只算 checkout 地址这 1 项。

2026-10-18 在本机连续运行 3 次，均为 **1 passed**（每次约 4 秒）。运行基于当时的工作树，包含 A 线尚未提交的改动：带 evidence 的 stated 写入上卡、撤销后重新生成卡片（`apps/workspace/src/services/assistant.ts`、`card.ts`、`sessions.ts`）。另做了一次变异检查：把 A 的写入改成 `observed` 后，第 3 步按预期失败（`C's first context read carries A's stated values`）。
