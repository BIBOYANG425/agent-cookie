# 双 Sample storefront + live UCP：演示取证说明

**状态：操作与证据模板；新路线的真实集成尚未完成，没有通过证据。** 本次用户同意的路线是一个真实 UCP 商家，加两个独立的 Anthropic `ShoppingAgent` 顾客 storefront。两店共用接入实现，使用独立的商家凭据、pairwise session 与 note 空间；不用 merchant 员工后台替代顾客 storefront。现场由 coding agent 安装的环节已推迟。

本说明记录这次演示决定，不改写 v0.3 的验收编号、标题或标准。A01–A22 仍全部为 `it.todo`；A03/A07/A08/A22 的自动验收将继续只打工作台 HTTP。A/B 线仍未交付冻结载荷、SDK 与 fake workspace；下述步骤是集成就绪后的操作说明，不是已运行结果。

## 证据中的三种对象

| 对象 | 如实标注 | 需要独立证明的行为 |
| --- | --- | --- |
| Storefront A | `Sample` 店铺、商品、种子；真实 LLM 调用 | A 的工作台身份、授权读取、回复、note 与撤销后拒绝 |
| Storefront B | `Sample` 店铺、商品、种子；真实 LLM 调用 | B 的独立身份、授权读取、回复、note 与回头客连续性 |
| UCP 商家 | `live` 商家与本次真实 cart 结果 | 实际商家来源、真实请求、cart 返回或实际失败 |

真实 LLM 不会把 Sample 店铺变成真实商家。两份相同网页或两个进程也不能证明两份身份与授权。UCP 的 live cart 不表示 checkout 已完成、已付款或已下单；不得拿本地 Sample 商品或录制 fixture 充当 live cart。若只能跑 fixture，记录为 fixture，并把 live cart 留为未完成。

两家 Sample 店按用户选择使用 blueprint 原有通用商品，不添加鞋类资产；原 A15 的 42 码标准仍保留待人同步，不能把通用商品回复记作该项通过。

## 执行前记录

- 记录本项目、上游、适配实现的提交与实际 runtime / 模型版本；记录两店实际地址和 storefront 注入点。两店可共用代码，但认证和 session 映射不能共用一份商家身份。
- 用各自凭据经 `GET /me` 确认两店返回不同商家身份。保存脱敏身份结果和配置来源，不保存钥匙、Authorization 头或上游聊天 session token。
- 确认两店的 `merchantKey = domain ?? agentId` 不同且稳定。不能把共同的 `localhost` domain 当作独立身份；由冻结契约决定使用不同 domain 还是稳定 agentId，不能自行扩展字段。
- 选定同一个 Sample 用户、两个不同 personal agent，以及尚未过期的授权。第二个 personal agent 必须绑定同一用户，不能借复用同一把个人钥匙伪称换 agent。
- 通过受信 host 把工作台确认的 pairwise ID 映射到对应 storefront 的主体；区分上游 `user_id`、随机聊天 session token 和工作台 session ID。不得由模型自报身份或默认 `demo-user` 授权。
- 禁用或隔离会误导结果的默认 Sample profile / memory seed。卡字段从工作台按策略读取，关系 note 从该商家自己的空间读取；不能用旧本地 memory 补上被拒的读取。

请求 body、返回 shape、可用 SDK 方法和回执关联等缺口必须由对应线冻结后再执行。这里列出的路径来自 v0.3 已有工作台 HTTP 表，没有添加新的端点或字段。

## 连续演示与证据

### 1. 一次公开需求，两次真实 LLM 回复

个人 agent 发起一个公开需求，通过冻结的工作台介绍路径将它交给 A、B 两店。记录实际 `POST /personal/intents` 请求与返回、被介绍的商家身份、两店握手和各自 `GET /agent/fields` 的真实状态。只发送获准的公开意图与握手，不把用户整张卡复制进发给商家 agent 的消息。

两店通过同一接入实现，用各自凭据按策略读取获准 context，交给各自的真实 LLM 调用。trace 应能对应到本店的实际 HTTP 读取、获准字段范围、模型调用和最终回复。只带文本前缀、硬编码两段回复、重播先前回复或只看到 HTTP 200 均不足以证明这一步。上游 SSE 即使为 200，也要检查实际内容、错误事件及本轮完成状态。

导出同一时间段的 `GET /owner/activity` 和可用的 `GET /personal/receipts`。敏感字段仅在真实所需用途下读取，不为制造回执多读地址。若 auto 读取暂不能导出所需回执，记录契约缺口，不能自己编造一条；HTTP 状态、工作台活动和真实模型 trace 必须分别保存。

### 2. 不同 pairwise ID，独立关系 note

保存 A、B 的实际工作台 session ID，验证同一用户在两店的 ID 不同。使用冻结的 `PUT /agent/notes/:key?sessionId=` / `GET /agent/notes/:key?sessionId=` 让各店写入并读回一条可区分的 Sample 关系 note。测试数据只作 note 内容，不新增身份卡字段；不要用完整用户卡或受限字段当 note。

取证分两组：同一个 note key 在 A/B 各有不同内容时，两店各读到自己的内容；另选只由 A 写过的 key，B 读取它与 B 读取一个不存在的 key 得到相同的不存在响应。保存状态与返回结构，避免响应泄露他店 key 或内容。隔离由工作台鉴权证明，不能只靠两套本地文件。

### 3. 撤销 A：下一次实际读取拒绝，B 仍可读

先经 `GET /personal/grants` 确认本轮 A/B 授权归属。通过 `POST /personal/grants/:id/revoke` 只撤销 A 的目标授权。随后用 A 原有身份、session 与被撤授权覆盖的字段发起新的实际工作台读取，保存 `403 GRANT_REVOKED`、活动和可用回执；不能用前端禁用按钮、模拟错误或模型口头拒绝代替。

在这次复核之间不重新介绍 A、不新发授权，也不把所有请求都切断。B 用自身仍有效的授权发起新的读取，应仍成功；保存 B 的 HTTP 结果和相应 trace。若两个商家共用 key、grant 或缓存，这一步不能算独立撤销。

如继续让 A 对话，保存适配器如何处理真实拒绝及模型实际回复，不以旧缓存冒充刚取得的授权数据。撤销只拒绝新的工作台读取；已进入旧聊天上下文的内容无法收回，不宣称模型已经忘记。

### 4. 换 personal agent 回到 B

保持同一用户与同一 B 商家，改由第二个 personal agent 发起新介绍。保存第二个 personal agent 的身份依据、介绍结果和 B 的新握手：B 的 pairwise ID 必须与第一次保存的 B ID 相同。

B 使用新的上游聊天 token 和空 transcript，用自己的商家身份重新读取自己的关系 note，形成实际 LLM 回复。保存这次 note HTTP 读取和模型 trace，证明关系连续性来自 B 自己可读的 note，而不是复用旧对话历史。第二个 personal agent 只接收 B 的回复，不直接翻 B 的私有 note。

这一步只演到换 agent；A22 的 reset 部分另按下面映射执行。不能因这一步成功就把 A22 改绿。

### 5. 独立展示真实 UCP cart

通过 A 线确认的工作台 UCP 路径使用一个 live 商家的真实在库商品创建 cart。保存实际商家来源、商品标识、请求时间、真实响应状态与 cart 结果；有 warning、售罄或上游失败就保留原始状态并如实说明，不补造成功。

本轮目标到 cart 为止。v0.3 的报价接受流程还可能继续 checkout，因此必须先确认已实现、已授权的 cart 止步边界；不得为了录制 cart 自动完成 checkout 或付款，也不在本文虚构一个 cart HTTP 端点。cart 阶段没有发生敏感读取时，不补造地址放行回执。

页面、口播、记录分别标出“两家 Sample storefront 的真实 LLM 回复”和“live UCP cart”。这一步不替代原 A09 的两商家 UCP fixture 匹配标准，也不等于 A17 的 iMessage 到付款链接全流程。

## 对现有验收的映射

| 原编号与标题 | 双店可提供的可观察证据 | 仍需保留的范围 |
| --- | --- | --- |
| A03 session ID 隔离 | 同一用户、不同商家身份，通过 HTTP 得到不同 pairwise ID | 两个不同字符串不能单独证明不可互推；推导算法仍需 A 线核心检查。HTTP 验收不导入其内部实现 |
| A07 撤销 | A 的授权被撤后，下一次真实字段读 `403 GRANT_REVOKED`；B 的独立读仍成功 | 不重新给 A 发 grant；不承诺收回旧值；只改 B 的界面显示不算 B 仍可读 |
| A08 note 隔离 | A/B 分别写读自己的 note；B 读取 A 独有 key 与不存在 key 响应相同 | 用真实商家凭据和工作台 HTTP；不能读 SQLite、git 或本地 memory 文件来代替隔离证据 |
| A22 回头客 | 第二个 personal agent 介绍同一用户到 B，B ID 不变；B 自读关系 note 后回复 | 还须在 `AGENT_COOKIE_DEMO=1` 下执行 `POST /demo/reset`，再介绍同一用户到同一 B，ID 仍等于重置前基线；握手和字段无电话、邮箱等全局标识 |

A22 的 reset 只验证稳定 ID 与规定的身份边界。reset 会重灌 fixture / 重置演示记忆，不能额外宣称临时写入的 note 会跨 reset 保留；回头客 note 证据应在 reset 前完成。保留固定用户种子与稳定 B 商家标识，由工作台实现，验收不读取密钥或直接改存储。

这些是已有条目的证据映射，不是新增验收编号。自动化仍只打工作台 HTTP，不因录屏而调用 storefront 内部对象或导入 MemoryStore；真实 LLM 与 UI trace 作为另外的集成证据存放。未实现断言、没有真实证据的项目继续保留 `todo`。

## 原 A15 / A16 的地位

[A15 零接入投递](A15-tier-zero.md) 保留 v0.3 的原版、零代码、首条回复条件；新双店路线用了接入实现，不能替它宣称通过。[A16 skill 生成的接入](A16-skill-integration.md) 仍要求干净克隆上真实执行 skill；本次推迟现场安装，即使预先完成共用适配器，也不构成 A16 通过。两个原模板均保留，编号、标题与等级不变。

## 执行记录（全部待采集）

下表是证据文件索引，不是 API 字段定义。实际执行后填入本目录的相对路径与真实结果，不预填成功。

| 记录项 | 当前记录 |
| --- | --- |
| 日期 / 执行人 / 提交 / runtime / 模型版本 | 待填写 |
| 两店实际 storefront 地址、身份与稳定商家标识依据 | 待采集；不含凭据 |
| Sample 用户及两个 personal agent 的同用户绑定依据 | 待采集 |
| 同一公开需求、两店 HTTP 读取、两次真实 LLM trace | 未执行 |
| A/B pairwise ID 对比、note 写读与不可见对照 | 未执行 |
| A 撤销、紧接的 403、B 新读成功记录 | 未执行 |
| 换 personal 回 B 的 ID、note 读取与真实回复 | 未执行 |
| A22 reset 前后 ID 与握手/字段边界检查 | 未执行 |
| live UCP 商家、商品和真实 cart 请求/结果 | 未执行 |
| 工作台活动、实际回执、连续录屏文件 | 待采集 |
| 每步结果、失败、契约缺口和限制 | 尚未完成真实集成 |

发布证据前去掉原始凭据、上游聊天 token、完整地址和支付信息。可以保留标为 Sample 的获准上下文以说明行为；用户卡不得整份出现在跨 agent 消息或证据截图中。为对照而遮蔽标识时要一致，不能把两个不同 ID 处理成同一个标签，也不能把 token 当成 pairwise ID。
