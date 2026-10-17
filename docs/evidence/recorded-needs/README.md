# 三条备选需求 · 录制素材与缺口

**三个真实 catalog 查询已录；三条完整 iMessage Recorded run 仍待录。** 不能将本目录说成已经完成的 A17、适码报价或 checkout 证明。

2026-10-17 22:17:12–22:17:16 UTC，用 UCP CLI 0.9.1 的隔离 `agent` profile，`OPT_OUT_INSTRUMENTATION=true`，对三种不同需求实际查询公开 catalog。每次保留原始响应、原话、查询词、本次预算、UTC 和 SHA-256，见 [manifest](captures/manifest.json)。脚本运行于 lane-c 的 `1d0ffff` 基线上，本次新增的 [record-needs.mjs](../../../fixtures/ucp/record-needs.mjs) 尚未提交时执行；没有覆盖旧 UCP fixtures。

先通过 `@agent-cookie/sdk` 的 `getMyCard()` 读取真实 4310，截取 [Sample 卡的相关字段及来源](card-context.json)。该快照用于本地核对，**卡值未拼进 UCP 查询**。本次没有创建 workspace intent、grant、quote、accept、cart、checkout 或地址回执，也没有调用 LLM。原话由 C 人工整理成搜索词；不当作已验证的 agent 意图理解。

## 三条素材

| 编号 | 原话及本次预算 | 原始查询 / 响应 / 派生清单 | 当前范围 |
| --- | --- | --- | --- |
| R1 · 日常通勤 | 最近每天走路通勤，帮我找双舒服的日常走路鞋，95 美元以内。 | [输入](captures/walking.input.json) · [响应](captures/walking.json) · [候选](captures/walking.selection.json) | 两家预算内 catalog 候选；尺码未核对，完整视频待录 |
| R2 · 周末徒步 | 周末想走山路，帮我找双防水徒步鞋，预算 160 美元。 | [输入](captures/hiking.input.json) · [响应](captures/hiking.json) · [候选](captures/hiking.selection.json) | 两家预算内 catalog 候选；防水/适用性须查商品详情，尺码未核对，完整视频待录 |
| R3 · 开始跑步 | 想开始在公路上跑步，帮我找双公路跑鞋，140 美元以内。 | [输入](captures/running.input.json) · [响应](captures/running.json) · [候选](captures/running.selection.json) | 两家预算内 catalog 候选；尺码未核对，完整视频待录 |

选择规则是按响应顺序取最多两家不同 `seller.domain` 的 `available=true`、USD、非负整数价格且不超**该次输入预算**的 variant。金额是美分；不要求具体店名、金额或尺码。清单每项指向原 JSON pointer，保留实际 variant 标签，注明 `sizeAssessment: unknown` 和“不可称适码报价”。这是人工核验前的候选素材，不保证商品特性、运费、含税总额、到货日期或当前库存。不能仅因有两条结果就把“用卡匹配成功”勾掉。

要切成视频兜底，B 必须为每条需求补齐 [A17 模板](../A17-imessage.md) 的连续手机原片、SDK 读卡、真实意图/报价、选择及 handoff/失败、checkout 回执。以 accept 的 quoteId 对应 agentId/sessionId 核对：若放行地址，只给选中一家且用途为 checkout，另一家拒绝；未放行或失败无需强求地址回执。A/B/D 还需完成通用 query/类别入口与尺码限制说明，见 [requests](../../requests.md)。SDK 目前拒绝这些 query；本次没有绕过 SDK 向工作台发意图。

## 复现与切换

只读复录命令（必须给新目录；旧响应不覆盖）：

```sh
OPT_OUT_INSTRUMENTATION=true UCP_BIN=/absolute/path/to/ucp \
  node fixtures/ucp/record-needs.mjs /absolute/path/to/new-capture-directory
node fixtures/ucp/verify-needs.mjs docs/evidence/recorded-needs/captures
```

`verify-needs` 只核对哈希、输入预算、JSON pointer、店家数、价格与尺码说明，不认证商品适用性或完整视频通过。可以在真实失败后展示本目录原始素材做技术解释，角标必须写 **Recorded catalog · 2026-10-17 UTC · size unverified**；不能显示“Live”或剪成手机已经拿到两家适码报价。不同现场需求不能借用旧报价，切换时明确展示另一条完整原话及原预算。

完整原片交付后分别登记文件、SHA、起止时间、代码 SHA、数据模式、性质核验结果，再把状态改为可用。旧固定场景视频不自动映射到 R1–R3。
