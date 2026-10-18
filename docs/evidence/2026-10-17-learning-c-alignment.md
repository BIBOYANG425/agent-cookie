# B：C 接缝复验与 OpenRouter 配置检查

2026-10-17 16:43 PDT。lane-b，A 0129f08、C 688754d、main 843666b；C 合入 B 的本地 merge 为 e9112cf。不自行合 main。本文更新先前 `2026-10-17-learning-b-verification.md` 的阻塞状态，旧记录保留为历史。

## 已验证的 C 修复

- Contribution 的嵌套 evidence 与 A 类型对齐，B45 已解除。
- A 传入的个人 agent 作者按 C 的受信 intent.agentId 校验，不再只认 literal personal。SDK 原记忆写回断言未删改，测试通过，B46 已解除。
- C 的 intent 历史投影排除 text/query/public 与报价自由文本。原 B44 中 Git intent 原话持久化部分已修复；A 的原始 Observation SQLite 队列仍未修复。
- C 控制台经真实 SDK 调 A 隔离后台，已覆盖十一种方法：原八种加 getLearning/getLearned/setLearning。实际读取 paused/learned，暂停后回读为 true，恢复后回读为 false；验证 SDK `{enabled}` 到 HTTP `{paused:!enabled}` 的映射。测试使用空 learned 列表，不冒充模型写卡成功。

## 检查结果

| 检查 | 结果 |
|---|---|
| SDK / rules / memory-repo / console 测试 | 79 / 52 / 29 / 35，共195项通过 |
| learn 路由/敏感过滤/结构化抽取/OTel 回归 | 43项通过（模型响应为合成协议） |
| SDK / learn / MCP / Photon / rules / memory-repo / console typecheck | 七包通过 |
| 控制台 SDK 学习方法新增覆盖 | 修改后单项聚焦集成测试通过；包含在 SDK 测试文件中，不额外算新用例数 |
| 修改后 SDK / learn typecheck | 通过 |
| learn build | 通过 |

测试均使用临时目录、隔离 SQLite 和本机临时端口。测试内 reset 只作用于隔离测试实例，未对现有4310发 reset。没有重启手机监听、改Claude全局配置或触碰演示DB/cursor/outbox。

## OpenRouter 实测边界

本地忽略环境文件由用户自行填入，权限0600；凭据未输出、未进Git。鉴权端点返回200。进行了三次合成输入请求：前两次固定Anthropic直连+ZDR返回404（第二次仅诊断固定错误类别）；官方ZDR列表确认该直连不适用，改为同一Haiku4.5模型的 `amazon-bedrock/us` 后第三次返回403。此后停止模型重试，等待上游访问条件解除。

最后一次实际输出：

```json
{"mode":"live-synthetic-input","model":"anthropic/claude-haiku-4.5","filtersPassed":true,"extractionPassed":false,"reason":"unavailable","requests":1,"httpStatuses":[403],"elapsedMs":324,"extractedFields":[]}
```

敏感句和群聊他人句先在本地拒绝，零模型调用；仅一条合成的明确颜色偏好进入每次模型请求，没有真实聊天、卡片写入或短信。未取得有效模型输出，不能声称模型质量、完整学习、晋升、历史擦除或实机链路已通过。账户页面/身份详情不纳入仓库证据。

路由保持 `allow_fallbacks:false`、`require_parameters:true`、`data_collection:deny`、`zdr:true`；不靠放宽隐私设置处理错误。依据：[官方ZDR说明](https://openrouter.ai/docs/guides/features/zdr)、[公开ZDR端点表](https://openrouter.ai/api/v1/endpoints/zdr)、[模型端点能力](https://openrouter.ai/api/v1/models/anthropic/claude-haiku-4.5/endpoints)。此处仅改托管端点，仍用 `anthropic/claude-haiku-4.5`，不声称是精确dated snapshot。

## 下一步依赖

- A/B44：Observation短期内存队列、保留stated、两独立来源去重、持久代际/暂停恢复/原子forget/历史清理/消息去重。
- A：loadLearn仍空桩，需接 createWorkspaceLearner + OpenRouter extractor；根依赖构建应纳入learn。B不改A目录。
- OpenRouter：访问条件解除后再跑一次真实合成检查；不自动周期重试403。
- Spectrum Cloud 与外部Sentry配置仍未就绪；新采集入口未启用。
- C无需再处理B45/B46；现正式白名单没有防水/徒步字段，B不自创映射。

L9只取得接口层进展；真实学习闭环保持未完成。
