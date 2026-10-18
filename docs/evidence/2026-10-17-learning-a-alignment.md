# B：A 新学习代码的隔离验收

2026-10-17。A e381b15（实现 fea1b22）、C 688754d 经 merge 0fbf12d 接入 lane-b。未合 main，未切换现有4310、Photon监听或Claude配置。本文更新 learning-c-alignment 的当前依赖状态；旧证据保留历史。

## 方法与范围

`packages/sdk/test/learning-acceptance.check.ts` 创建真实 A 后台、SQLite、C rules 与 Git memory-repo，全部使用自动清理的临时目录。业务调用经真实 SDK → HTTP handler；只通过 A 测试时钟与学习生命周期辅助函数加速等待。原话持久化检查仅在临时测试文件中寻找合成金丝雀字节，不查询或修改实际演示数据库。

抽取器通过 B `createWorkspaceLearner` 注入合成响应。Jev、Haiku、Spectrum、外部遥测均未真实调用；UCP 使用 fixture。接受报价只是 fixture handoff，没有真实订单、付款或短信。每条观察先确认已排队，避免把根本未采集误当成隐私通过。

运行（根目录、Node22）：

```sh
pnpm --filter @agent-cookie/sdk exec tsx test/learning-acceptance.check.ts
```

此探针明确返回退出码 **1**：六个要求中一个通过、五个未满足。它没有被命名为默认单测，也没有通过反转断言把缺陷算成通过。完整精简结果见同名 `.json`。

## 实际结果与定位

| 人的要求 / 场景 | 实际结果 | 状态 |
|---|---|---|
| 明确稳定陈述直接上卡 | B输出stated，后台读回candidate、basis observed | 未满足 |
| 同一agent两段不同对话支持同值 | 第二段被去重，只保留1份证据、1个writer，仍candidate | 未满足 |
| 同一agent两段对话，第二次处理时间移至31天后 | 已保留2份不同conversation证据，但只有1个writer，仍candidate | 未满足 |
| 模型在途时暂停再恢复 | 释放迟到响应后learned为0，paused为false | 通过 |
| 原话只在内存排队 | 处理前可在临时SQLite/WAL文件字节找到完整合成金丝雀 | 未满足 |
| Desktop发起、同机主Photon接受同一fixture报价 | handoff成功，但memory.write(intent)=failed 1条，SCOPE_DENIED | 未满足 |

- `apps/workspace/src/services/learning.ts` 的 apply 仍把 stated 降为 observed；按 agent+field+value 的30天去重不考虑独立conversation。A29/A31对“不同来源”的说明和人的“两段不同对话”要求不同，验收按人的要求保留。
- `services/card.ts` 新增 mergePrefsStrictly 用 `Card.sources.length < 2` 阻止晋升；C `rules/src/learning.ts` 明确 Card.sources 是writer agent IDs，独立证据来源是conversation/intent。31天场景用来绕开30天去重、单独暴露这个语义冲突；不能要求用户换两个个人agent才能学到同一个偏好。
- A epoch 存入 settings，并在应用前复核。本次实际验证暂停→恢复→迟到响应不写回；没有声称进程重启、所有撤销竞态或完整历史擦除均已验证。原子forget/消息去重仍待A。
- `db.ts` 的 enqueueObservation 仍把 text 写 observation_turns。处理时删除不满足“原话从未落盘”；当前失败证据只需排队阶段即可复现。
- A afterIntent 保留原始 intent.agentId（正确归属），但 writeMeta 使用接受者 actor.agentId；C appendIntent 要求作者等于 record.agentId。跨个人agent时被拒绝。请A/C冻结作者与操作执行者语义；B没有修改身份字段、冒充作者或放宽权限。原同agent历史回归仍通过，不能把旧B46整体视为再次失败。

## 其他检查

- 现有 SDK **79项测试通过**，包含十一种控制台SDK方法和同agent的C历史写回。
- SDK / learn / MCP / Photon / workspace **五包类型检查通过**；探针补排队确认后SDK类型检查再次通过。
- 探针补确认后复跑结果一致。没有循环修A/C，也没有改掉失败断言。

## 后续依赖

A/C修复以上明确陈述、来源单位、原话内存队列和跨agent历史身份问题；A仍需导入已实现的 `createWorkspaceLearner`、配置抽取器并将learn纳入根构建依赖。原子forget、历史证据清理及可信消息去重仍未交付。详见 docs/requests.md B49；不改A/C实现。

用户选择先完成本地联调、模型稍后处理。OpenRouter key此前鉴权200、Haiku请求403；此轮零真实模型请求。Jev仅评估为可选分类器/有限候选选择方案，尚未改接或真实调用。现有手机采集与演示数据保持，L9真实学习闭环仍未完成。
