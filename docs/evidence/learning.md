# C17–C20 · 动态记忆与对话旁听学习

状态：**A 的学习端点、C 的持久化/展示/撤销已实连；C20 的真实模型学习与偏好排序仍未通过。** 两家真实 catalog 报价已录下，不能用这份未验证学习影响的基线证明排序成功。

## 本轮核对的版本

2026-10-17，PR #18 / `lane-c`。A 最新 `0129f085e297942ad174b34f02b26ab28d789822`；B 在本轮推进到 `e24957c9261e06da779ba57cc0adfbc9c1e83a89`。提交前再次检查：B最新 `4dfa81c` 仅新增 OpenRouter 本机配置检查脚本和文档，学习 SDK/learner 源码与上述 e24957c 相同；A无新提交，open PR仍只有C的#18。当前 main `843666b` 尚未包含学习契约。已读取 [B 学习计划](https://github.com/BIBOYANG425/agent-cookie/blob/e24957c/docs/lane-b-learning-plan.md) 和实际代码；未把早期 B 提案继续当作正式响应。

- `Contribution.evidence` 是 `{ intentId?, conversationId?, snippet? }`；pref 字段严格使用 A 的十项白名单。
- `GET /personal/learned` 返回 `{ paused, learned }`，按 field/value 分组。`sources` 是作者 agentId；独立学习来源从 evidence 的 conversationId/intentId 计算，不能把两个作者算成两段对话。
- B `getLearned()` 读列表，`getLearning()` 读暂停状态，`setLearning({ enabled })` 转为 HTTP `{ paused: !enabled }`。控制台逐条撤销使用真实 `evidence.contributionId`，不制造组 ID。
- 默认 rules/parser/memory 入口已支持嵌套 evidence。A 的 flat `IntentRecord` 由 memory-repo 接收，作者用实际 personal agentId；自由文本 text/query/public、商品 title/seller 不写入 Git 历史，仅存结构化摘要。旧 C 预览格式保持可读。
- 剩余 `TODO(contract)` 主要是 main 尚无共享类型时的结构化投影和导入迁移；运行时载荷已对齐，不再等待端点名称或猜测 confirmed/id 的含义。冲突语义另列 requests，未擅改 A/B。

## 实际 HTTP 与 catalog 证据

工作台监听 `127.0.0.1:4310`，运行 A `0129f08` 加本次 C 包；独立临时数据，`AGENT_COOKIE_DEMO=1`、`AGENT_COOKIE_UCP=live`、`AGENT_COOKIE_TEST=0`、`LEARN_TICK_MS=1000`。身份和初始卡为 **Sample**；UCP 商品查询为实际 live。没有接受报价或付款。应用仍由 A 的默认 `loadLearn` 启动，它返回空结果。

| 材料 | 可证明的结果 | 不证明什么 |
| --- | --- | --- |
| [learning-backend-http.json](learning-backend-http.json) | 23:15 UTC 的身份核对、学习读取、暂停及恢复、人工 stated 贡献一次上卡、真实 contributionId 撤销并回读确认；两句观察 HTTP 202；两家 live 报价 | 人工贡献不是模型抽取；queued 不代表已学会；报价顺序不是偏好生效证据 |
| [learning-console-bridge.json](learning-console-bridge.json) | 5173 控制台服务端到 4310，owner key 来自服务端环境，读取/暂停/恢复均 200 | 该次记录使用旧 SDK 缺方法时的 HTTP fallback；不代表新 B SDK 或浏览器截图 |
| [learning-sdk-bridge.json](learning-sdk-bridge.json) | 23:21 UTC，重启5173加载B e24957c真实SDK；身份卡/授权/回执/活动/学习读取及暂停恢复，共10请求200；暂停状态恢复原值 | 没有模型提取或截图；demoReset/revokeGrant只核对方法存在，本次未调用 |
| [learning-idle-observation.json](learning-idle-observation.json) | 两句输入后超过5分钟静默，读取200、paused=false、learned仍为空 | 空响应不是C20通过 |
| [learning-backend-probe.mjs](../../tests/acceptance/learning-backend-probe.mjs) | 可重跑的 HTTP-only 记录器；只清理本次唯一人工贡献，未知写入结果不谎报清理成功 | 不负责生成模型结论，也不会自动把 C20 标绿 |

本次请求没有预算，因此只核对最多两家、不同商家，不套用旧 $120 或固定尺码。实际返回的商品和价格保留在 JSON 作为观察结果，不成为测试常量。报价缺结构化尺码说明，故本轮不声称已验证尺码适配、缺码说明、地址隔离或完整 checkout。

对话探针通过 HTTP 投递“周末又去徒步，上次脚湿透了”，再投递“帮我找双鞋”；这不是 iMessage/个人 agent 的录屏。正文不保存为运行日志；仓库里的上述短句是用户指定的演示输入。

## C20 仍缺的真实环节

1. B 已交 `createWorkspaceLearner`、Haiku 提取器、SDK observe 和 Spectrum 采集；A 默认 `loadLearn` 仍恒返空。用户本轮明确：**OpenRouter 凭据和模型接线由 B 线处理，尚未完成。** C 不继续等待凭据，不把模型桩当实录。
2. A `LearningService.apply` 仍把 stated 降为 observed，并按同 agent+field+value 全局去重，第二段独立对话会被丢掉。C 的单源/双源规则已修好，不能替 A 的写入语义打勾。
3. A 的偏好排序目前只有 pref.brand/color，pref.avoid 用于排除；原预览中的防水/徒步字段不在正式白名单。不能凭商品名猜防水，也不能把“帮我找双鞋”当成第二份独立偏好证据。需要 A/B 确认允许提取的字段和相应 catalog 排序属性。
4. B 的短期原文策略与 A 的 SQLite 观察队列、暂停/忘记代际语义仍有跨线缺口。已追加 [requests](../requests.md)，C 没有改 A/B 目录或承诺彻底删除历史。
5. 浏览器工具拒绝本地控制台刷新，原因为 URL 协议策略，本轮未获取新截图；没有换浏览器或其他路径绕过。HTTP 证据可继续核验，不能代替实际界面/排序录屏。

## Sample 与真实证据的边界

[fixtures/learning/console.json](../../fixtures/learning/console.json) 已改为正式白名单中的 `pref.material` / `pref.color`，使用 A 分组载荷。empty/candidate/learned 均明确标 **Sample**；暂停、撤销只操作页面内存。真实模式不会自动切换 Sample。

旧 [空状态](learning-empty.png)、[候选](learning-candidate.png)、[已上卡](learning-learned.png)、[暂停](learning-paused.png) 是上一版预览 fixture 的历史截图，含当时未冻结的示例字段；**不能用于证明本轮正式契约的界面或真实 C20**。新的端点已不是 404，旧说明由本页本轮结果取代。

## 验证与复跑

- 使用 Node 22，在保持 main `843666b` 契约逐字节不变的临时副本运行：根 typecheck 通过；根测试 545 passed（另 1 skipped、4 既有 todo）；console build 通过。rules 52、memory-repo 29、console 35，覆盖嵌套 evidence、独立来源、平面意图脱敏、实际作者及 SDK 参数。
- B `e24957c` 加当前 C 的隔离副本：rules 52、memory-repo 29、learn 43、SDK 79 通过，四包和 workspace typecheck 通过。SDK 包含实际 A SQLite + C Git 集成；旧纯 A overlay 的 UCP 类型错配在 B 的整合契约中已消失。A workspace 全套214 passed、4既有todo；最新console bridge11与实际SDK→A桥接1项复验通过。无模型调用。
- 学习性质/通用性质与配置日志保护共 19 项通过（6 项配置回归先红后绿）；独立 acceptance typecheck 通过。错误 URL/key 仅输出固定错误码，两次真实 Vitest 负向入口检查均未泄露 sentinel。它们检查响应性质，不固定店名、价格或尺码，不复制 A 的 P0 自动项。
- 针对真实 4310 单独运行 `learning-http.test.ts`：只读契约 smoke 通过，空 learned 合法；该 smoke 明确不计 C20。真正的 C20 用例要求非空真实短证据及来源，不能靠 200 或手工注入通过。
- 曾误将带 URL 的完整历史 acceptance 套件运行在这个专用实例：12 个旧执行项因 `/test/clock` 未启用而失败，并执行了 reset hooks；这不是本轮学习验证结果。结束后重新执行限定文件与全新 HTTP 探针，以上 JSON 来自重跑。不要在此服务运行未限定文件的旧套件。

C20 只有在真实通道/模型提取、可核验的学习状态、受控合格候选集的排序效果和实际界面证据齐全后才勾选。
