---
name: add-agent-cookie
description: 在已有商家 agent 的代码中接入 Agent Cookie，定位主体和 memory 读写点，以冻结的 SDK 或允许的 Python HTTP 契约封装，并保留原有过滤与删除语义。用于开发者请求的 Tier 2 接入。
---

# Add Agent Cookie

目标是在现有 agent 的 memory 边界接入工作台，让该商家用自己的 pairwise session 读取获准字段、写自己的关系 note。不要替换业务后端、绕过过滤器，或把共享身份卡复制成商家数据库。只修改用户授权的目标仓库与目录。

## 先核对契约与基线

读目标仓库的指令、启动方式、memory 协议与现有测试。记录 commit 和干净工作树状态，先跑原版，分别记录服务启动与模型聊天结果。没有模型凭据时继续做确定性检查，明确聊天未验证。

取得 Agent Cookie 已冻结的 `packages/contract/src/types.ts`、`policy.ts`、`apis.ts`、`endpoints.ts`，并核对工作台路由实际请求/响应和 SDK。执行时记录实际工作台提交，不沿用历史验证结论；C 本次取证基线是 main `8c1a869`，`packages/core` 是旧路径。`MemoryRepoApi` 是工作台内部持久化接口，不能当作商家 HTTP 或 SDK。确认 session、用途、可写 field/basis、note 大小/过期/删除、错误码、认证头及幂等语义。

依赖未合入时，可以先做明确标为 Sample 的内存 port、fixture 和确定性测试，并在未实现边界标 `TODO(contract)`；不发明远程字段、端点或 SDK 方法。完整 HTTP store 缺删除/generation 等能力时应启动失败或明确报错，不能空操作后返回成功，也不能把本地测试当作真实授权验收。

TypeScript 通过 `packages/sdk`；本项目计划特许的 Python blueprint 用 `httpx` 按冻结 HTTP 契约调用，不另建 Python SDK。不直接访问 SQLite、用户 git 记忆库或 `CARD.md`。API key 只由 host 环境提供，不能由模型工具参数选择。

## 接入顺序

1. **定位主体。** 从受信 session 建立路径追踪到 memory 的 subject 参数。区分聊天 token、上游 user ID、Agent Cookie pairwise ID。由受信 host 建立映射；模型给出的 userId / agentId / purpose 不构成授权。不得把所有顾客绑定到一个固定 Sample ID。
2. **定位完整读写面。** 找 prompt 初始读取、搜索、显式保存、post-turn 提取、直接编辑、单条删除、清空、启动 seed 与缓存。按真实协议实现所有方法。记录默认 preferences 是否另有来源，避免旧值在新卡前覆盖。
3. **包装 storage 边界。** 每次需要字段值时通过工作台验证当前 session/grant/purpose。按冻结映射把允许字段转换成目标 memory 对象，保留来源信息；关系事实来自本商家的 note。握手的 available 只列字段名，lang/tone/length 三个风格值按契约保留；只有工作台的 Tier 0 文本前缀允许放入策略批准的 auto 字段值。不得把受限字段写进 note、把拒绝结果改成成功，或回退到旧的本地值绕过撤销和过期。
4. **保留写入过滤。** 原来的 fence、敏感信息拦截、长度限制、category、source tag、删除后的并发保护继续生效。可写字段与 basis 由确定性策略决定；不能把模型归类结果无条件标为 `observed`。不在可写集合内的内容也不是自动可存的 note：只有获准的关系事实可以进入 note。商家不能借 `clear` 或 `delete_fact` 删除共享身份卡或别家资料。
5. **核对 seed、生命周期与失败。** fixture seed 不得被当成真实贡献写入工作台。HTTP 客户端设超时并在应用结束时关闭；重试遵守冻结的幂等契约。处理过期、撤销、策略拒绝、note 不存在与上游不可达，不能吞掉异常后声称持久化成功。若原协议要求删除后 generation 递增，保留其语义；没有相应契约则报告差异，不用空方法凑接口。

## 验收

对新适配器写针对可观察行为的测试，再运行原版相关测试。覆盖两主体/两商家的隔离、每次重新授权、到期与撤销、未知 note、不合规写入不触达 HTTP、字段/basis 分流、note 限额、删除后并发提取不能复活、超时/拒绝不假成功。工作台验收只能通过 HTTP；不能通过数据库或 git 文件给测试布置授权。

在另一个干净外部克隆上用本 skill 生成接入，检查 diff 只包含适配器、必要的 wiring 和相关测试。对照验收参考而非复制参考实现。实际读到字段、写回 note 后才声称 A16 通过。录屏必须是实际运行；素材只可标 `Recorded run`，不能用重建动画、剪辑好的静态输出或 Sample 响应冒充现场执行。

交付时给出改动路径、基线 commit、执行命令、真实结果与仍未验证的项目。仅有代码检查不叫“接入已验证”。

## Anthropic commerce-agents 的已核对基线

该例子已核对源码、启动流程、独立 session/SSE transport，以及六方法 Sample 内存参考；Agent Cookie 深度接入尚未验证。目标是此仓库时，阅读 [references/commerce-agents.md](references/commerce-agents.md)，按固定 commit 重新确认路径；不要假定计划中的“三方法、约 80 行”适用于当前上游。

本仓库 [fixtures/expected](../../fixtures/expected/README.md) 是验收参考，不是要复制到用户仓库的交付实现。已通过的测试只覆盖绑定、关系事实过滤、隔离、读写/搜索/删除、clear generation 与上游提取中途 clear；没有真实 HTTP MemoryStore、A16 模型聊天或干净克隆录屏证据。单条删除在原版中不递增 generation；原版检查 generation 后再写入也不是跨 worker 原子操作。需要服务端条件写入或等价同步屏障后，才能宣称防止所有删除复活竞态。

若用户只要求先验证双 shopping agent 的授权上下文和有限关系 note，可评估现有 get_preferences 与 save_memory / recall_memories 接缝，关闭未接入的持久 memory/extraction/seed，不实例化残缺 MemoryStore。模型调用前必须有明确的工作台授权 gate；上游偏好预取会吞掉异常。明确说明此范围不包含完整删除/清空/自动提取，也不等于 A16 的完整 MemoryStore 接入。工作台载荷仍须冻结，不能以“最小版”为由猜字段或返回假授权。
