# C14 · 独立 HTTP 验收运行

**实际结果：11 项规范 HTTP 测试通过，1 项独立 reset 支撑检查通过，11 项规范仍 todo。** Vitest 汇总为 **12 passed / 11 todo / 23 collected，exit 0**。没有宣布 P0 全绿、完整 demo 重跑或真实模型 / UCP checkout 成功。

## 来源与边界

- 验收规范：仓库 `docs/plan.md` v0.3，22 个编号和标题保持原文；P0 15 项、P1 7 项。
- 工作台：A 线 `bd9d6e3` 外部只读源码快照，真实 loopback HTTP 服务；最新复测为 `http://127.0.0.1:4318`，与 C10b 的 4310 隔离。测试未合并或修改 A 源码。
- 适配器：该快照仍装载 A 自带 RulesApi / MemoryRepoApi / UcpApi stubs。此次结果不是 C rules/memory 包或 D UCP 包的集成证据；内存记忆适配器也不能证明真实 git 持久化。
- Node：22.23.3；Vitest：4.1.10。最终机器报告：[C14-http-results.json](C14-http-results.json)。报告由 Vitest 实际生成，未手填通过状态。
- 验收包已补独立 `typecheck`、TypeScript 5.6.3 与 Node 22 类型依赖；检查通过。锁文件仅改本包，规范标题与计划逐字核对、报告中的 Sample key 扫描也通过。
- 外部运行目录：最新为 `/private/tmp/agent-cookie-c10b-runtime-rq8escjo/c14-ale_bu0f`；临时 fixture 副本在其 `fixtures/`。仓库 fixture 文件未修改。
- 服务环境由启动者确认：`AGENT_COOKIE_DEMO=1`、`AGENT_COOKIE_TEST=1`、`AGENT_COOKIE_UCP=fixture`、`FIXTURES_DIR` 指向临时副本；隔离数据目录，未使用用户真实记忆。
- 临时副本相对仓库的运行差异：Sample ACME 的 `chatEndpoint` 移除，新增 `callbackUrl=http://127.0.0.1:4359/callback`。sink 只回 204，不记录载荷、不调用模型。原 users、agentId、贡献、capabilities 与 Sample dev-key 绑定保持。
- 测试只读取允许的 `fixtures/dev-keys.json` 和 `fixtures/address.json`；钥匙不写入证据。所有状态观察只通过 HTTP，不 import workspace/core、不读取 SQLite 或 git 记忆库。
- 普通用例动态注册独立 Sample 商家、使用随机 capability 和本地 callback 收件器，绕过 UCP/LLM。接受的只是本地 Sample 报价，返回 `.example` handoff URL；未访问该 URL、未发真实 checkout 或付款。

## 已执行的规范 HTTP 断言

| 编号 | 本次检查 |
| --- | --- |
| A01 注册 agent | 注册 shoe / owner 授权 personal；钥匙对应角色与类别；无效钥匙 401；非 owner 不可注册 personal |
| A02 合并规则 | 单商家和同商家重复不构成 quorum；inferred 不计；两商家 observed 上卡；撤销支持后掉卡；personal stated 不被单商家覆盖 |
| A03 session ID 隔离 | 不同商家 ID 不同；自己的 ID 可读；别家 ID 与不存在的 ID 都返回相同 404；无法用已知他店 ID 读取字段 |
| A04 握手只有字段名 | 仅规范字段；风格值允许；available 只含标准字段名；无地址/预算值或全局身份；callback 载荷仅公开 intent |
| A05 按用途读字段 | auto 可读；意图 budget=120 覆盖 card budget=900；接受前以及接受后的错误用途拒绝；仅被接受商家可读地址；另店仍拒绝；敏感读取回执与不含值的 activity |
| A06 过期 | 服务端 clock 拨过 expiresAt；握手/字段/note 写返回 GRANT_EXPIRED；清理恢复 offset 0 |
| A07 撤销 | 下一次字段/握手读取 GRANT_REVOKED；另店授权保持；商家无权替用户 revoke |
| A08 note 隔离 | 各自写读；别店相同 key、跨 session 和不存在的响应一致；同名 key 不串值；超 2 KB 拒绝 |
| A11 注入 | VIP 文本与商家伪造 stated 降为 inferred；payload 中 userId/agentId 不改变实际主体；不上卡且另一商家不可读 |
| A13 并发与幂等 | 五个相同 key 的并发 intent 仅发一组 grants；重复相同、改 body 冲突；quote/accept 可重放；不同调用者不共享 key 缓存 |
| A22 回头客 | 两个 personal 每次均新增对应商家 grant，获得同一 ID；reset 后仍等于 reset 前基线；握手/字段的键集合白名单和全局身份检查通过；关系 note 换 personal 后保留，reset 后清除 |

A03 的 HTTP 结果只证明隔离和归属检查，不能单独证明 HMAC 不可逆性。A22 是工作台身份和 note 行为证据，不是两次真实 LLM 对话证据。撤销只限制未来读取，不声称收回已经进入对话历史的值。

独立支撑检查验证固定种子 card 恢复、grants/receipts 清空、临时注册钥匙失效、Sample callback 报价/接受/note 流程可以再跑。它不验证完整 live demo、真实 UCP 或 git 硬重置，因此 **A12 仍 todo**。

## 仍未通过

| 编号 | 缺失证据 |
| --- | --- |
| A09 | 真实录制 catalog 经真实 adapter 得到两家合格商家及仅对应代理获授权。当前 StubUcp 不算；实录 US 11 / US 9 也不是 EU 42 库存证明 |
| A10 / A17 | 真实 Claude Desktop MCP / iMessage 客户端链路证据 |
| A12 | 固定种子下完整 demo 重跑 |
| A14 | 真实控制台展开来源及撤销操作证据 |
| A15 / A16 | 原版零接入首条模型回复 / 干净克隆由 skill 生成接入并真实执行 |
| A18 | 真实可追溯售罄及 requires_escalation 响应、continue_url 和用户可见告知；模拟状态开关不能替代 |
| A19 / A20 / A21 | 实际 passkey、验签和支付单次限额链路 |

这些待办的原编号、标题和等级未改变。现有真实 UCP 目录/购物车实录仍是独立证据，未被此测试冒充端到端通过。

main 另外带入的 D 线 `fixtures/ucp/checkout-create.marathonsports.myshopify.com.json` 有 `requires_escalation`，两份 checkout-complete 记录为 `INSUFFICIENT_PERMISSIONS`。它们不是此次 HTTP 测试使用的 adapter，也不包含本项所需的售罄证据；不能把 403 当成已经下单或把局部失败记录当成 A18 全通过。

## 命令与实际重试

执行目录：`/Users/mac/LA Hacks 2026/tests/acceptance`。

```sh
AGENT_COOKIE_URL=http://127.0.0.1:4318 /private/tmp/agent-cookie-c-node22/node_modules/.bin/node node_modules/vitest/vitest.mjs run \
  --config vitest.config.mjs --reporter=verbose --reporter=json \
  --outputFile.json=../../docs/evidence/C14-http-results.json
```

- 首轮：2026-10-17 13:41:43 America/Los_Angeles，exit 1，11 passed / 1 failed / 11 todo。A22 失败为 Sample ACME grants 数量 0，失败断言是 `expect(own.length).toBeGreaterThan(0)`。没有降低断言。
- 原因：运行进程启动时加载的 fixture 没有 Sample ACME callback；之后改磁盘副本，reset 仍使用启动时内存快照。
- 修正：由启动者重启同一 A 快照服务，装载临时 fixture 的安全 callback。未改业务代码或验收标准。
- 复测：2026-10-17 13:42:09 America/Los_Angeles，exit 0，12 passed / 11 todo；约 770 ms。这是强化断言前的历史结果；当前机器报告对应下述最新复测。

运行方法和全部实际 runtime 前提见 [tests/acceptance/README.md](../../tests/acceptance/README.md)。工作台和 sink 由父任务负责生命周期；测试只关闭自己启动的 callback 收件器，结束时未关闭外部工作台。

## C10b 后的强化复测

- 2026-10-17 14:10:40：A01–A08/A11/A13/A22 全部通过，reset 支撑检查新加的“重置前必须已有回执”失败（0 条）。检查 A `services/fields.ts` 后确认其只为释放的 purpose 字段写回执，auto 字段读取只有活动记录。这是相对于“每次放行写回执”硬规则的缺口，已追加给 A，不视为满足该硬规则。
- reset 支撑检查改为先写 Sample 地址、接受本地 Sample 报价，再真实读取 checkout 地址以产生回执；仍保留非空前置断言及 reset 后必须为空断言。没有把空数组当作清空成功。
- 2026-10-17 14:11:06：**12 passed / 11 todo，exit 0**，类型检查通过。新增断言还验证了接受后错误用途仍拒绝、A22 每次介绍有新 grant、响应只能包含契约允许的键。
- 当前结果文件准确记录此次 4318 运行；A 的原版 UCP loader 未接录制目录，缺少 `ucp-offers.json` 时仍使用自带 Sample offers，A09/A18 继续 todo。
