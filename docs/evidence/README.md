# 验收证据索引

更新：2026-10-17。当前源码基线为 main `35e8b56`（PR #25 已合并）。此页索引已发生的验收，不将旧录制改称当前版本现场实测。状态统一为 **通过 / 手动证据 / 已砍 / 阻塞**；括号说明范围。A15/A16/A23 按人的最新收口裁决标记，原始执行材料保留。

| 编号 | 文件 | 状态 | 日期 |
| --- | --- | --- | --- |
| A01 注册 agent | [HTTP 验收](../../apps/workspace/test/acceptance/a01-a04.test.ts) | 通过（自动 HTTP） | 2026-10-17 |
| A02 合并规则 | [HTTP 验收](../../apps/workspace/test/acceptance/a01-a04.test.ts) · [学习补充](2026-10-17-learning-live.md) | 通过（普通字段按 writer；pref 按独立证据） | 2026-10-17 |
| A03 session ID 隔离 | [HTTP 验收](../../apps/workspace/test/acceptance/a01-a04.test.ts) | 通过（自动 HTTP；算法向量另见 rules） | 2026-10-17 |
| A04 握手只有字段名 | [HTTP 验收](../../apps/workspace/test/acceptance/a01-a04.test.ts) | 通过（auto 风格值与字段名按契约） | 2026-10-17 |
| A05 按用途读字段 | [HTTP 验收](../../apps/workspace/test/acceptance/a05-a08.test.ts) | 通过（地址仅选中商家 checkout） | 2026-10-17 |
| A06 过期 | [HTTP 验收](../../apps/workspace/test/acceptance/a05-a08.test.ts) | 通过（POST /test/clock） | 2026-10-17 |
| A07 撤销 | [HTTP 验收](../../apps/workspace/test/acceptance/a05-a08.test.ts) | 通过（后续读取拒绝，不承诺收回已传内容） | 2026-10-17 |
| A08 note 隔离 | [HTTP 验收](../../apps/workspace/test/acceptance/a05-a08.test.ts) | 通过（自动 HTTP） | 2026-10-17 |
| A09 意图匹配 | [HTTP 验收](../../apps/workspace/test/acceptance/a09-a13.test.ts) · [UCP 通用搜索](2026-10-17-ucp-generic-search.md) | 通过（录制 UCP fixture；不等于实时库存） | 2026-10-17 |
| A10 真实客户端 | [Desktop 实录](A10-real-client.md) | 通过（手动 Claude Desktop / MCP，录制基线） | 2026-10-17 |
| A11 注入 | [HTTP 验收](../../apps/workspace/test/acceptance/a09-a13.test.ts) | 通过（商家输入不能扩权） | 2026-10-17 |
| A12 重置复演 | [HTTP 验收](../../apps/workspace/test/acceptance/a09-a13.test.ts) · [限定重置](cognition-skill-interop.md) | 通过（隔离 fixture；只重置四个受管路径） | 2026-10-17 |
| A13 并发与幂等 | [HTTP 验收](../../apps/workspace/test/acceptance/a09-a13.test.ts) | 通过（自动 HTTP） | 2026-10-17 |
| A14 控制台 | [字段与来源](C18-direction-change.md) · [SDK 实连](C10b-sdk.md) | 手动证据（Sample 来源撤销、SDK 实连；当前截图见 console/） | 2026-10-17 |
| A15 零接入投递 | [历史尝试](A15/README.md) | 已砍（Tier 0 协议不匹配，2026-10-17 决定） | 2026-10-17 |
| A16 skill 生成的接入 | [Claude Code + Devin 实录](A16/README.md) | 通过（Claude Code + Devin；按 2026-10-17 人的收口裁决） | 2026-10-17 |
| A17 iMessage 主流程 | [取证入口](A17-imessage.md) · [真实收发](2026-10-17-real-adapters-verification.md) | 手动证据（搜索→选择→handoff 日志；连续原片待补） | 2026-10-17 |
| A18 UCP 失败路径 | [HTTP 验收](../../apps/workspace/test/acceptance/a18-a22.test.ts) · [录制目录](../../fixtures/ucp/README.md) | 阻塞（handoff 已验；真实售罄和 escalation 两种录制仍 todo） | 2026-10-17 |
| A19 passkey 解锁 jar | [auth 测试](../../packages/auth/test/auth.test.ts) | 阻塞（库级实现与测试已有；缺真实手机 passkey 证据） | 2026-10-17 |
| A20 商家验签登录 | [TAP 互通](2026-10-17-tap-interop.md) · [auth 测试](../../packages/auth/test/auth.test.ts) | 手动证据（库级成对钥匙/验签；真实商家登录闭环未声明通过） | 2026-10-17 |
| A21 支付单次限额 | [pay 测试](../../packages/pay/test/payments.test.ts) | 手动证据（授权边界测试；不代表真实支付） | 2026-10-17 |
| A22 回头客 | [HTTP 验收](../../apps/workspace/test/acceptance/a18-a22.test.ts) · [同店 session](2026-10-17-postmerge-b-verification.md) | 通过（同店 session 连续性；未声称商家模型记忆开场） | 2026-10-17 |
| A23 stock skill 互操作 | [Cognition stock skill 实录](cognition-skill-interop.md) | 通过 | 2026-10-17 |
| B49 学习六场景 | [真实模型 6/6](2026-10-17-learning-live.md) · [新 gate 6/6](2026-10-17-gate-redesign.md) · [历史 C 复跑](B49/final-report.md) | 通过（真实模型、合成输入、隔离 SQLite/Git、fixture commerce） | 2026-10-17 |
| C20 手机学习与报价排序 | [手机实录](2026-10-17-phone-learning-live.md) · [新 gate 状态](2026-10-17-gate-redesign.md) | 阻塞（旧手机首次误计双源；更正后 gate 停止；新 gate 尚缺干净正向实机与排序） | 2026-10-17 |
| R1–R3 Recorded run | [需求素材](recorded-needs/README.md) | 阻塞（catalog 查询素材已有，连续手机原片待补） | 2026-10-17 |
| T8 Sentry | [离线 trace / logs](T8-sentry.md) | 手动证据（离线验证，缺外部 Sentry 界面） | 2026-10-17 |

P0 = A01–A12、A17、A18、A22。A 的自动 HTTP 验收为主，C 不重复扩写整套。A18 的两个真实录制缺口和 A17 原片缺口仍需单列，不把已有自动项通过描述为所有 P0 已完成。

C14 已收口：A15 退出 demo，A16 两个 coding agent 的接入实跑按人确认通过，A10/A17 由 B 提供而 C 维护索引。**C11 仍为 P1 BLOCKED**，A16 收口不代表缺失的完整 note 生命周期已交付。

每次演示核对性质：至多两家不同商家；报价不超本次预算；地址仅在 accept 后按 checkout 给被选中的一家；尺码不匹配或未知时明确说明；本次意图优先于卡上的默认。商品名、价格、尺码只作为当时观察值，不能成为固定的通过条件。

真实模型六场景使用合成测试输入，不替代手机实机学习与报价排序。手机原话不复制进文档，模型来源与贡献 ID 足以追溯。所有 Sample / fixture / Recorded run 必须显式标注，付款链接不等于付款完成。

历史材料：[C14 HTTP](C14-http-acceptance.md)、[控制台初版](C09-fixture-card.md)、[HTTP 操作](C10-console.md)、[窄屏检查](C16-console-polish.md)、[双店 UCP](two-storefronts-and-ucp.md)。旧失败记录保留，不因新版已修而改写。用户已有 docs/media 原片未核验，不作为本索引的通过依据。
