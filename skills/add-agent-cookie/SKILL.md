---
name: add-agent-cookie
description: 在已有商家 agent 的代码中接入 Agent Cookie，定位主体和 memory 读写点，以冻结的 SDK 或允许的 Python HTTP 契约封装，并保留原有过滤与删除语义。用于开发者请求的 Tier 2 接入。
---

# Add Agent Cookie

目标是在现有 agent 的 memory 边界接入工作台，让该商家用自己的 pairwise session 读取获准字段、写自己的关系 note。不要替换业务后端、绕过过滤器，或把共享身份卡复制成商家数据库。只修改用户授权的目标仓库与目录。

## 先核对契约与基线

读目标仓库的指令、启动方式、memory 协议与现有测试。记录 commit 和干净工作树状态，先跑原版，分别记录服务启动与模型聊天结果。没有模型凭据时继续做确定性检查，明确聊天未验证。

取得 Agent Cookie 已冻结的 `packages/core/src/types.ts`、`policy.ts`、HTTP 请求/响应和 SDK 契约。计划草稿、接口名字和代码注释不能替代缺失的载荷契约。确认 session、字段用途、可写 field/basis、note 格式/大小/过期/删除、错误码、认证头、幂等语义。契约缺失时完成定位和需求报告，暂停依赖它的适配代码；不造字段、端点、SDK 方法或可用 fake server。

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

该例子目前只核对了源码与启动流程，Agent Cookie 深度接入尚未验证。目标是此仓库时，阅读 [references/commerce-agents.md](references/commerce-agents.md)，按固定 commit 重新确认路径；不要假定计划中的“三方法、约 80 行”适用于当前上游。
