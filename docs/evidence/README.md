# 验收证据索引

2026-10-17 起，**C14 只收集手动证据**。P0 自动项由 A 线的 [apps/workspace/test/acceptance](../../apps/workspace/test/acceptance) 维护，用户确认已执行 66/66；C 不在 `tests/acceptance` 重复扩写整套；按最新要求维护已有历史断言和通用性质检查。该数字不替代 A10/A17 的真实客户端证据，未录制失败路径也应以 A 的最新报告单列。

| 编号 | 文件 / 入口 | 状态 |
| --- | --- | --- |
| A10 · Claude Desktop MCP（B） | [A10-real-client.md](A10-real-client.md) | 待 B 放入真实客户端截图 / 录屏与工作台活动；当前文件是证据模板 |
| A15 · 原版 ACME Tier 0（C） | [A15/README.md](A15/README.md) | 已实际尝试，**BLOCKED / 未通过**：旧 Sample 卡前缀已投递并写回执，原版返回 401；正确协议诊断又遇模型凭据缺失，没有首条 assistant 回复 |
| A16 · Claude Code（C） | [A16/README.md](A16/README.md) | 独立实跑完成；新增 21 项测试、34/34 HTTP 步骤通过。有限 preferences/note 接入已验证；完整 MemoryStore 与全程录像仍缺，A16 BLOCKED |
| A16 · Devin（C / Devin） | [交接说明](A16/devin-brief.md) | 用户授权的[独立实跑](https://app.devin.ai/sessions/94dae4b1d11547c698d04be4119e41eb)完成；新增 10 项测试、29/29 HTTP 检查通过。完整 MemoryStore 未实现，A16 BLOCKED |
| A17 · iMessage 主流程（B） | [B 实际收发日志](https://github.com/BIBOYANG425/agent-cookie/blob/52321186803b9738a4aa956338af094679a12c7e/docs/evidence/2026-10-17-imessage-real-adapters.json)、[B 联调报告](https://github.com/BIBOYANG425/agent-cookie/blob/52321186803b9738a4aa956338af094679a12c7e/docs/evidence/2026-10-17-real-adapters-verification.md)、[原片待交项](A17-imessage.md) | 已合并的 PR #12 交付真实搜索 / 选择 / handoff 日志（三条 delivered、一次 accept 和 checkout 地址回执）；连续原片待 B，尚不标完整 A17 通过 |
| C20 · 动态记忆与对话旁听学习 | [learning.md](learning.md) · [真实 HTTP](learning-backend-http.json) · [真实 SDK](learning-sdk-bridge.json) · [静默后读取](learning-idle-observation.json) | 正式契约/读取/暂停/贡献撤销已实连，两家 live 报价为基线；B负责OpenRouter接线，真实学习与排序、当前界面录屏仍待，未通过 |

A15 核对原版首回是否正确使用本次卡上适用的 auto 字段，不要求固定字段或具体数值；仍需实际投递回执与运行前后代码未改证明。错误截图不能代替成功回复。A16 必须各自从干净克隆开始，由 Claude Code 和 Devin 独立应用 skill，并实际读到授权字段、写回本商家 note；仅基线测试、生成 diff 或部分录制不构成通过。C11 缺 note 枚举、删除、clear 等完整生命周期契约，保持 **P1 BLOCKED**，详见 [requests](../requests.md)。

## 新方向的性质验收

人的最新要求覆盖旧固定商品示例；保留原始历史日志的店名、价格和尺码，不把它们当后续通过条件，也不改写历史记录。下列性质需对每次意图独立核验，缺少证据标“待验证”，不能用页面看起来有两张卡代替。

| 性质 | 核对材料 | 通过条件 |
| --- | --- | --- |
| 商家数量 | 本次 intent 的原始报价、seller/agentId 与界面 | 展示 ≤2 家不同商家；目标两家，缺货或无合格结果时如实解释，不凑足两家 |
| 本次预算 | 原用户需求、解析后的 intent、报价金额/币种 | 每条展示报价 ≤ 用户本次预算（统一最小币种单位）；不回退到覆盖本次预算的历史默认，不承诺含税运费总额 |
| 地址目的与对象 | accept 的 quoteId→agentId/sessionId、同时间段 activity/receipts、另一商家拒绝读取 | accept 前不放行地址；accept 后若发生地址放行，只能给选定一家且用途为 checkout；blocked/failed/handoff 没有放行也如实保留；公开意图/握手/其他商家都不含地址值 |
| 尺码和偏好 | 该次 SDK 卡快照及来源、商品 variant 标签、用户可见消息 | 采用适用的卡字段；尺码不匹配/未确认时有说明且不称为适码；不做无来源换码；无适用尺码的商品不套鞋码 |
| 来源与时间 | 原始 UCP 响应、时间、模式、SHA | 店名/价格/库存取自当次真实响应；fixture 和 Recorded run 明示采集日期，不称实时库存 |

| 备选需求编号 | 文件 | 状态 |
| --- | --- | --- |
| R1 · 日常走路鞋 | [walking 入口](recorded-needs/README.md#三条素材) | 目录查询支撑素材；完整 A17 Recorded run 待 B，未通过 |
| R2 · 防水徒步鞋 | [hiking 入口](recorded-needs/README.md#三条素材) | 目录查询支撑素材；完整 A17 Recorded run 待 B，未通过 |
| R3 · 公路跑鞋 | [running 入口](recorded-needs/README.md#三条素材) | 目录查询支撑素材；完整 A17 Recorded run 待 B，未通过 |

旧 A17 已录日志的实际报价/checkout 仍有效，但不证明通用意图解析或这三条新需求已跑通。旧 A15 文件中的具体尺码属于当时观察值；当前验收按上表，不能把旧失败截图改标成功。

## 历史与支撑证据

- [C14 HTTP 历史结果](C14-http-acceptance.md) / [机器结果](C14-http-results.json)：旧工作台基线 11 项规范 + 1 项支撑检查通过、11 todo，保留历史，不代表当前 A 自动套件状态。
- [新方向检查与控制台字段截图](C18-direction-change.md)：本次性质断言、泛化字段展示及三条 catalog 素材的范围说明。
- 控制台：[Sample 身份卡](C09-fixture-card.md)、[HTTP 展示/撤销/reset](C10-console.md)、[SDK 接线](C10b-sdk.md)、[320px 与键盘检查](C16-console-polish.md)。
- [TAP 库互通](2026-10-17-tap-interop.md)：独立签名互通记录，不代表工作台出站已签名。
- [双店与 UCP 取证说明](two-storefronts-and-ucp.md) 与 [早期脚手架](scaffold-verification.md) 保留原始上下文，不替代 A15/A16。

P0 = A01–A12、A17、A18、A22；P1 = A13–A16、A19–A21。各执行者提交真实文件、时间、commit、命令和判定理由。Sample 数据明确标 `Sample`，录制回放标 `Recorded run` 并注明数据模式。去掉钥匙、支付 token、完整地址和手机号；保留字段名、方法、状态与必要关联。用户已有 `docs/media/agent-cookie-demo.mp4` 尚未核验，不将其列为通过证据。

## A 线补充（2026-10-17）

| 项目 | 证据说明 | 当前状态 |
| --- | --- | --- |
| [Live UCP 冒烟](live-ucp-smoke.md) | 两家真实报价 → accept → handoff；live 下 Sample 地址不发给真实店家 | 未完成：Shopify 主机被网络策略拒绝（CONNECT 403），没有真实报价；Sample 地址规则由单元测试覆盖 |
| [T8 Sentry tracing + logs](T8-sentry.md) | 每个请求一条 trace、每次 UCP 调用一个子 span、活动与 UCP 日志 | 离线验证通过；sentry.io 被拒，缺 Sentry 后台截图 |
