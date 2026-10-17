# B 线：正式 SQLite 后台联调（2026-10-17）

本轮在 `lane-b` 集成并验证 A/C/D 的已推送代码。没有合并或推送 main，没有真实付款或订单。

## 版本范围

| 来源 | 已检查并合入 lane-b | 内容 |
| --- | --- | --- |
| A | `bd9d6e3` | Hono/SQLite 后台、冻结 contract |
| C | `a1d581e`（包含 `dacbc1e` fixtures） | 用户/个人 agent seed、规则、C07 Git 记忆存储 |
| D | `e34800f`，`lane-d-contract` | 对齐 contract 的 UCP 适配器及 auth hooks |
| main | 本轮最后刷新为 `8e48ea0` | 尚未包含 A 正式后台；此记录不代表 main 已集成 |

## 当前本机线路

`apps/workspace` 监听 `127.0.0.1:4310`，使用独立的忽略文件 `apps/workspace/data/lane-b-integration.sqlite`、根目录 C fixtures，`AGENT_COOKIE_DEMO=1`。旧 `workspace-fake` 服务已停止，代码保留作 fallback。

Photon 与 Desktop 分别读取各自本地 `.env` 的 `sample-personal-photon` / `sample-personal-desktop` 对应 key；两端 `AGENT_COOKIE_SAMPLE=1`。真实凭据及旧配置备份均被 Git 忽略、权限 0600。迁移保留了消息游标与去重记录，清除了旧 fake 后台报价引用。

**A 的默认 adapters.ts 仍使用 stubRules / stubMemoryRepo / StubUcp。** 即使环境变量写 fixture，也尚未自动加载 `packages/ucp` 的录制适配器。C/D 包已合入不等于运行服务已切换这些实现。

## 已验证的行为

- 实际 HTTP → SDK：两个个人 key 读出相同卡片（lang=zh、tone=简短、shoe_size=42）；C seed 当前没有卡片预算或地址，找鞋预算来自本次 intent。
- Stub 报价：11995 / 10999 美分，展示 $119.95 / $109.99 USD；两条 etaDate 都为 null，没有承诺周五到。
- 同一用户的两个个人 agent 介绍同一家商家，session ID 相同；三家商家的 session ID 互不相同。实测见 `2026-10-17-sqlite-integration.json`。
- C 独立 `address.json` 未被 A seed loader 导入。accept 返回需去商家页面补地址的 handoff；没有伪造 shipping_address checkout 回执。另用 A 自带 Sample seed 的独立测试验证了选中商家的一条 shipping_address 回执及 accept 幂等。
- owner activity 的实际 envelope 是 `{events}`；SDK 兼容它与 fake 的 `{activity}`，拒绝同时带两个 envelope。个人 key 读取 activity 被 403 拒绝。
- SDK 和 Photon 覆盖 AcceptResult 四种状态。handoff 无 continueUrl 时说明缺链接；failed/blocked 有 continueUrl 时保留；ordered 需有 orderId；Sample 始终保留。只有一条报价时不再提示选择第二双。
- **真实 iMessage 已复验**：测试者向原线路发送找鞋和选择第二双，两条外发均通过 Photon API 读回 delivered，用户确认收到报价和交接链接。证据：`2026-10-17-imessage-sqlite.json`。这是实际手机 + SQLite + 桩报价。
- **实际 MCP stdio 进程已复验**：构建产物读取 Desktop 本地配置，连接当前 4310，get_my_card/find_agents 成功，四个工具存在，Sample 保留，stderr 为空。
- **Desktop UI 本轮未重新验收成功**：重启后用户重新打开原聊天，但原生 UI 操作工具返回 noWindowsAvailable，输入未生效。此前 fake 后台的 Desktop 截图和工具证据仍有效，但不作为这次 SQLite 的 UI 证明。

## 录制 UCP 的独立接入探针

通过 A `createDeps(config, {ucp})` 的既有注入点，把 D `createUcp({mode:'fixture'})` 接到 A Hono/SQLite，再由 SDK 请求。此探针未改 A 的默认 adapters，未切换手机服务，未外呼真实商家。

- 50 条归一化 offer，经 A 当前 42 码/$120 过滤，只留下 `shoebacca-prod.myshopify.com` 的 11997 美分报价；etaDate=null。
- `parseSize('9 US')` 返回 undefined，复现 D 提过的后缀尺码问题。不能把 US9/US11 实录直接当 EU42 库存证明。
- 该匹配商家缺 cart-create 录制文件，accept 返回 failed / UPSTREAM_ERROR，仍带 continueUrl。此失败来自 fixture 覆盖不足，不是真实商家登录失败。原始上游错误含本机路径，需 A/D 对外脱敏。
- 详见 `2026-10-17-recorded-ucp-probe.json`。没有通过放宽尺码或伪造第二条报价来凑成功。

## 检查结果

| 检查 | 结果 | 边界 |
| --- | --- | --- |
| SDK | 38 passed，typecheck/build 通过 | 包括 A SQLite + C seed 的两项集成测试 |
| Photon | 38 passed，typecheck/build 通过 | 最终包含单报价提示修复；测试本身不代表手机送达 |
| MCP | 7 passed，build 通过 | stdio 测试初次受沙箱 loopback 限制；获准本机监听后通过 |
| CLI | 5 passed | CLI 回归 |
| A workspace | 102 passed，2 todo | 当前仍基于 A adapters 的桩；首次缺 SQLite native binding，重建后通过 |
| C rules | 27 passed，typecheck 通过 | 新的确定性合并与无损格式化 |
| C memory-repo | 11 passed，typecheck 通过 | C07；regenerateCard/resetToSeed 仍抛 C08 not implemented |
| D UCP | 10 passed，typecheck 通过 | 离线 fixture/模拟 runner；没有 live checkout |
| D auth / pay | 8 / 6 passed；pay 1 skipped；typecheck 通过 | 包级回归，未接入运行后台的支付链路 |
| C fixtures / UCP verify | 通过 | 数据结构/实录完整性不等于当前鞋码匹配或真实订单 |

不宣称整个 P0、A15/A16 或生产环境已经通过。

## 交给 A/C/D 的下一步

1. A 在 adapters.ts 使用 C rules；等 C08 完成后再切 memory-repo，避免启动/重置走到未实现方法。
2. A 接入 D 的新版 UCP，并由 A/C/D 对齐尺码、匹配商家的录制 coverage、catalog→cart→checkout 复验及公开错误信息；保留明确的 fixture/live 区分。
3. A/C 明确独立地址 seed 如何进入卡片，随后复验只给选中商家放行地址及回执。
4. A/C 对接 console 真实数据和双店演示；C 当前静态预览不因本轮 API 通过而自动算联调成功。
5. main 由人合并；B 的客户端及兼容性修复在 lane-b。
