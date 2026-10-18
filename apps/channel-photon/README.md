# Photon iMessage — 个人 agent 与通道

本包提供个人 agent 的持续 Socket.IO 连接、离线 Sample、配置检查，以及限时 ping 探针。运行者需在 Photon 控制台准备项目和共享 iMessage 线路，把凭据保存在本机、被 Git 忽略的 `.env` 中；仓库不含可共用的凭据或测试者身份。

## 不需要账号的本地检查

使用 Node 22.12 以上的 22.x，在仓库根运行：

```sh
pnpm install --ignore-scripts
pnpm --filter @agent-cookie/sdk build
pnpm --dir apps/channel-photon typecheck
pnpm --dir apps/channel-photon test
pnpm --dir apps/channel-photon build
pnpm --dir apps/channel-photon check
pnpm --dir apps/channel-photon demo
```

`check` 只输出是否有效和缺失变量名，永不打印值，也不访问网络。`demo` 使用内存中的 Sample 消息，应显示 `externalCalls:0`、`outboundMessages:0`、`deliveryConfirmed:false`。它只证明消息筛选逻辑可跑，不证明 Photon 或手机已接通。

## 真实通道验证入口

将本目录的 `env.example` 复制为 `.env`，在本机填写：

| 变量 | 含义 |
| --- | --- |
| `PHOTON_API_KEY` | 有 `project:read` 权限的项目 key；需要回复时也要 `project:write` |
| `PHOTON_PROJECT_ID` | 目标项目 ID |
| `PHOTON_TEST_SENDER` | 用来发 ping 的本人 iMessage handle，与 Photon 收到的格式完全一致 |
| `PHOTON_AGENT_HANDLE` | 分配给项目、能够接收此测试者消息的 agent iMessage handle |
| `PHOTON_PLATFORM` | `imessage` |

根据 [Photon 官方 iMessage 入门](https://photon.codes/docs/beta/get-started/imessage) 创建/选择项目并完成 line assignment；这些步骤不由本脚手架执行。测试者从手机发起直接会话，在探针开始等待后发送一条新的 `ping`。

先仅验证接收，不发回复：

```sh
pnpm --dir apps/channel-photon smoke
```

需要真实验证一条回复时，再明确选择发送模式：

```sh
pnpm --dir apps/channel-photon smoke --send
```

探针最多运行 2 分钟，每轮间隔 2 秒；只匹配启动后、指定双方之间、iMessage 直接会话里的一条纯文本 `ping`。它忽略其他人、群聊、旧消息和其他内容。回复使用收到的 space/agent ID，在同一会话发送固定文本，不携带身份卡。每条请求有超时，翻页有上限；失败不自动重试发送，幂等 key 来自原消息 ID。

共享 iMessage 线路使用普通文本消息，不传 `parentMessageId`：2026-10-17 的真实测试中，引用回复被 Photon 以 HTTP 409 `SPACE_NOT_SENDABLE`（`Replies are not supported for this Space`）拒绝；省略该字段后发送成功受理。不要在结果不明时自动更换请求或幂等 key 重发；先核查 API Activities，确认原请求被拒绝且没有发出消息。

该次验证中，Photon 记录输入为 `received`、测试回复为 `delivered`，测试者也确认手机收到固定回复。这证明已配置环境的一次真实收发；探针运行结束后不会持续自动回复，新机器仍需自行配置凭据与测试身份。

结果语义：

- `received`：探针见到符合条件的输入，没有发消息。
- `accepted`：Photon 接受回复请求；仍需在手机上看到回复，程序不会宣称已送达。
- `timeout`：等待内没见到有效 ping，返回非零退出码。
- `SEND_OUTCOME_UNKNOWN`：发送结果不确定，先查 Photon 活动，勿直接再发一条。

## 持续个人 agent

已实现 [Photon Beta Socket.IO](https://photon.codes/docs/beta/websocket/events) 事件流，固定已查询的 API version `2026-07-01`。按官方 schema 读取 `message.received` 的 `data.object`，验证 project、双方 handle、direct space 与时间。不是把 webhook reply 当 iMessage；外发仍调用 `projects.sendMessage`。

在 Photon `.env` 中添加 `AGENT_COOKIE_URL` 和个人 `AGENT_COOKIE_KEY`，启动本机后台并构建 SDK 后：

```sh
pnpm --dir apps/channel-photon start
```

支持「身份卡」、不同商品的整句需求、「选2」「回执」。当前采用有边界的确定性文本识别，**没有调用 LLM**；不声称能处理任意自然语言。所有业务读写都通过 SDK。保留整句 text，并仅提取明确的预算、尺码、颜色和截止要求，不拼接整张卡。选择仅映射当前 direct space 已展示的报价，消息中的 userId/agentId/quoteId 不形成授权。

Socket.IO 自动重连最多 5 次，每次用持久 cursor 重新订阅；串行队列上限 128。`.runtime/channel-state.json`（0600、Git 忽略）保存账号绑定摘要、游标、报价和发件箱，最多 2000 条处理记录。运行锁阻止同一状态文件的并发进程；不要另设状态文件启动同一条线路。首次启动从新事件开始，正常重启后从成功检查点恢复。发送前先持久记录，消息 ID 派生幂等 key；不明发送结果会停止并要求人工查看 Photon Activity，不会自动换 key 重发。

`SEND_OUTCOME_UNKNOWN`：先通过 Photon 按原幂等 key/消息核查外发记录。确认已发出后才可把对应 outbox 标为 sent（保留 outgoingId），明确拒绝且未发出才可恢复 ready；不确定时保持停止。异常退出留下 `.lock` 时，先确认该 PID 已不存在，再移走旧锁，保留状态文件。不要删状态文件来“修复”去重。

当前联调使用 `apps/workspace` 的 SQLite 后台，监听 4310，已接真实 rules、Git memory-repo 和 D 的 UCP 录制适配器。Photon 的本地 `AGENT_COOKIE_KEY` 取自 `fixtures/dev-keys.json` 的 `sample-personal-photon` 条目，Desktop 使用不同的 `sample-personal-desktop` 条目。当前 `AGENT_COOKIE_UCP=fixture` 回放商家录制，设置 `AGENT_COOKIE_SAMPLE=1` 保留演示标识；不代表实时库存。`apps/workspace-fake` 仅作为可选内存 fallback；切换后台或重置数据后应重新搜索商品，不能复用旧报价。

Demo 同时只做一个购物任务，避免另一个 MCP find 替换当前授权。Sample、未知 ETA、handoff、失败和商家警告都会出现在回复中；handoff 没有链接时明确说明，failed/blocked 带 continueUrl 时保留它。没有实际付款或真实订单。2026-10-17 切换 SQLite 后的两条回复均由 Photon 读回 delivered，测试者确认收到报价与交接链接，见 `docs/evidence/2026-10-17-imessage-sqlite.json`。这不代表真实 UCP 商家已接入。

## 现场演示话术（2026-10-17 text 契约）

已接 A b824139 的 IntentRequest.text 和 Quote.sizeNote：SDK、MCP、Photon 及隔离 SQLite 联调通过。原 4310 演示进程尚未切换，旧手机/Desktop 截图不能证明新入口；本轮无需重新发送旧测试。

现场从下面三句中任选一句，也可以换成自己的需求；不绑定固定的商品、价格或两条报价。没有明确表达的条件不补猜，最终匹配范围和可用报价以实际商家返回为准。

| 需求示例 | 只抽取用户明确表达的条件 |
| --- | --- |
| 「想找一双日常通勤穿的鞋，42码，预算90美元。」 | 预算 90、尺码 42；没有截止日期，不补日期。 |
| 「帮我找件黑色外套，M码，150美元以内，周五前到。」 | 预算 150、尺码 M、颜色黑色、截止要求“周五前到”。 |
| 「给朋友挑个生日礼物，60美元以内，下周三前送到。」 | 预算 60、截止要求“下周三前送到”；不推断尺码、性别或礼物品类。 |

MCP 的 `request` 必须保留用户原话，映射到 SDK 的 `text`。`query`、`budget`、`size`、`color`、`deadline` 仅在能从本次请求抽取时填写；`query` 不预设为跑鞋，也不把整张身份卡拼到用户原话里。Photon 同样保留整句，确定性抽取或模型只负责抽取；匹配、授权和是否可以购买仍由工作台决定。当前卡片的鞋码不能自动当成外套尺码。

使用 fixture 时先确认它覆盖所选需求；当前正式 UCP fixture 返回固定录制，尚不按 query 匹配；回复明确标出非实时搜索及可能不对应需求。真实无匹配应显示暂无匹配，不能给无关鞋款换名冒充结果，也不能宣称已验证任意品类都有库存。三句话通过了隔离协议测试，其中多品类目录为合成测试桩，不是实机或商家库存证明。

本轮实机基线是 `docs/evidence/2026-10-17-imessage-real-adapters.json`：14:43 PDT 两次找鞋，14:49 PDT 选择第二双；三条回复均经 Photon 读回 `delivered`，用户确认收到交接链接。它与上段旧桩报价记录是两轮不同的验收。

演示前确认工作台、Photon 监听与 Desktop 使用同一个 4310 后台；只使用已配置的测试对话。保持 `AGENT_COOKIE_UCP=fixture` 和 Sample 标识，不点商家付款按钮。不要为排练重置已取证数据库或删除 Photon 状态文件。需要新报价时重新搜索；10 分钟授权过期后不能接着选旧报价。

| 拍 | 操作 / 用户原话 | 画面及讲解 |
| --- | --- | --- |
| 1 | iMessage 发「身份卡」 | 保留 Sample，不显示地址或支付资料。讲：“个人信息由工作台管理，商家按权限读取与任务有关的部分。” |
| 2 | 从上面任选一句需求，原句发出 | 展示实际返回的商品、价格和来源，不预写商品名或结果数量。讲：“助手把我的整句需求交给工作台，能识别的条件单独提供。”没有结果就明确显示没有匹配，不继续选择。 |
| 3 | 展示报价尾部 | 若有 `sizeNote`，逐字保留商家的尺码提示；ETA 未知就说未知。截止要求不等于商家配送承诺，尺码提示也不等于保证合身。 |
| 4 | 根据实际列表发「选1」或「选2」 | 只选择已显示的报价。若返回 handoff，保留来源、实际链接及商家提示。讲：“这一步把我交接到所选商家；尚未付款，也未确认订单。” |
| 5 | 发「回执」，同时打开控制台对应 checkout 回执 | 只看商家、字段名、用途和时间；以实际回执为准，确认敏感字段仅按授权交给所选商家，不能把 Tier 0 回执当作地址回执。 |
| 6 | 完成手机选择后，再在 Claude Desktop 调 `get_my_card`、`find_agents` | 用 `sample-personal-desktop` 身份查询同样需求，保留 Sample。对照新引介的授权与手机 checkout 回执，核对同一家店的 pairwise session。讲：“个人助手换了，同一家商店认出的还是同一位用户。” |

第 6 拍的“店家读 `last_order` 并主动开场”必须有实际商家服务读取和模型回复证据才能展示。当前 UCP proxy 会在 handoff 时写 `last_order`，但这不等于已付款，也不等于商家模型已经读到它。不要让 Claude 根据提示代写“欢迎回来”冒充商家输出；缺少这条链路时，只展示已核对的 session 连续性，并说明商家开场尚待接通。A10 与同店截图索引见 `docs/evidence/A10-real-client.md`；已请 A 将未付款交接标成 `last_handoff`，避免把选择误称购买。

新方向的联调验收：三种不同需求的原句均到达工作台；缺少可选条件时不填默认值；不再校验 `kind='trail_shoes'`；外套尺码和颜色不被鞋码覆盖；`sizeNote` 有值时原样显示、缺失时不生成说明；无匹配、单条/多条报价和新搜索失败后的旧报价清理行为保持正确。单元测试、隔离 HTTP 验证与真实手机/Desktop 验收分别记录，旧找鞋截图仅证明旧版本。

## 失败与交接文案

以下是当前 `src/agent.ts` 的实际输出规则；尖括号是后台返回值，不是额外编造的商品、地址或链接。商家原话可能是英文，应保留其真实含义。

| 返回 / 情况 | 手机显示与讲解 |
| --- | --- |
| `handoff`，有 `continueUrl` | `[Sample 演示] 已准备好所选商品的交接链接：<链接>`，随后显示后台提示和“尚未付款，也未确认订单。此结果仅供演示。”登录受限属于交接，不播报购买成功。 |
| `handoff`，无链接 | `[Sample 演示] 商家需要继续处理，后台未提供交接链接。`，保留后台提示及未付款 / 未确认订单说明；不猜一个 URL。 |
| 选择时商家明确报告售罄 | 按后台 `failed` 显示 `[Sample 演示] 本次操作失败：<商家售罄说明>`；有后续链接时保留，并说明“未确认订单或付款”。讲：“所选商品已无法完成这次交易，请重新搜索商品。”只有明确的商家售罄证据才能这样讲。当前两家 fixture 是登录受限链路，未取得售罄的实机证明。 |
| 搜索返回零条报价 | “没有找到符合条件的报价。”不把零结果自行解释成售罄，也不显示第二项选择提示。 |
| 后台返回 `failed / UPSTREAM_ERROR` | `[Sample 演示] 本次操作失败：<后台公开说明>`；如提供 `continueUrl`，显示“后台提供的后续处理链接”和未确认订单 / 付款说明。不得把失败包装成 handoff 成功。 |
| 无到货日期（`etaDate=null`） | “到货时间未知”；如后台有 `etaText` 则接着原样显示。用户提出截止日期时补“目前不能保证你要求的到货时间。”不把用户希望的日期当作商家承诺。 |
| 网络或未知异常 | “后台暂时无法完成请求；未确认新的订单或付款。请稍后查看回执再重试。”不回显原始异常、路径、密钥；先查回执和 Photon Activity，不重复提交不确定的交易。 |
| `blocked` | `[Sample 演示] 暂时不能继续：<后台拒绝原因>`；权限拒绝不伪装成商家故障。 |
| 失效报价或撤销授权抛错 | “这次报价已失效或权限已撤销，请重新搜索商品。”若后台返回 `blocked` 结果而非抛错，则沿用上一行和后台原因。 |
| `ordered` | 仅后台明确返回此状态及订单 ID 时显示“后台确认订单”；Sample 仍须保留。当前 fixture 演示预期是 handoff，不能提前承诺 ordered。 |

Photon `SEND_OUTCOME_UNKNOWN` 属于通道发件状态，不是订单状态。按上文恢复流程人工核查，不删除去重状态、不更换幂等 key 重发。上述失败文案有代码与隔离测试覆盖，但不能替代真实商家售罄 / 上游失败录制的端到端验收。

## 合并后的 SDK 与依赖检查

控制台写方法 `revokeGrant(id, options?)`、`revokeContribution(id, options?)`、`demoReset(options?)` 已在 `@agent-cookie/sdk` 中实现，支持 `AbortSignal`；`demoReset` 只用于明确授权的 owner 演示重置。验证这些写方法使用隔离测试，不操作当前手机演示数据。

B 包的内部依赖声明使用 `workspace:*`，统一从仓库根执行 `pnpm install --frozen-lockfile`。根 `pnpm-lock.yaml` 的 `version: link:../sdk` / `link:../../packages/sdk` 是 pnpm 正常生成的本地解析值，不应手动改成 `workspace:*`，也不建立 B 包独立锁文件。

## 对话旁听学习（Photon 2.0 Beta）

实机五分钟验收时，运行后台的 Mac 要接电、保持开盖。可临时运行 `caffeinate -i -t 900` 防止十五分钟内的自动闲置休眠；它不能阻止合盖休眠，也不改变系统的长期电源设置。休眠/断网期间定时处理无法按时完成，不能把手机收到确认回复当成已经学到。Photon 有限重连耗尽会以 `RECONNECT_FAILED` 退出：恢复网络后先确认旧进程已退出、原 outbox 全部为 `sent`，再用原 `.env`、`AGENT_COOKIE_LEARNING_BINDING=workspace-v1` 和原状态文件启动唯一监听；不要删除 cursor/outbox、绕过锁或自动重放旧消息。未知发送结果继续按既有停止规则处理。验收以新消息自然空闲五分钟后的后台贡献和控制台读回为准。

人的最新确认：Photon 团队要求继续使用 `app.beta.photon.codes`。现有 `pho_prj_` 项目、`PHOTON_API_KEY` 和原 iMessage 号码保留，`serve` 的同一个 Socket.IO 收消息循环负责采集，不要求另外登录旧平台或提供 `SPECTRUM_PROJECT_ID` / `SPECTRUM_PROJECT_SECRET`。`spectrum-ts` Cloud 与 Beta 是不同产品；旧 `serve-spectrum` 入口保留供真正的 Cloud 项目使用，不用于这条 Beta 线路。两入口共用原运行锁和状态文件，不能并行启动或另换状态文件绕过锁。不使用 `@spectrum-ts/imessage-local`，不读电脑上的其他聊天。

通道显式开关：本机忽略的 `.env` 中设 `AGENT_COOKIE_LEARNING_BINDING=workspace-v1`，仍运行原 `serve` 命令。后台须先支持学习端点，并显式设 `AGENT_COOKIE_LEARN_PROVIDER=openrouter`、从本地加载 `OPENROUTER_API_KEY`；当前默认 Jev1.14 + gpt-oss120b。仅有模型 key 不会自动启用。启动时读后台暂停状态并保留本机已有暂停，失败则退出并释放锁；正常停止旧监听、确认 outbox 无未知发送结果后才能切换。

采集：同一受信 Beta 事件先验证 API 版本、项目、human 发件人、agent 收件人、原测试号码、direct space 和 plain text，再经 `adapter.toEvent` 归一化 → 机主/敏感过滤 → 非阻塞有界内存队列 → SDK Observation。全部群聊保守忽略；稳定 HMAC conversationId / messageId 不靠时间切片或进程重启制造新来源。队列最多32个等待项、并发1、TTL30秒、10秒超时。5分钟前的历史消息不补学，重复已发送消息不再采集/回复；学习上报失败不影响回复，不将输入正文落盘。原 cursor/outbox 和未知发送停止机制保留，成功发送后删除该条 outbox 的回复正文。暂停/恢复/忘掉命令不成为学习证据。

普通偏好聊天使用确定性确认，不冒充完整聊天模型；单有商品名或“平时怎么买”的描述不触发搜索，只有明确请求句才走购物。Beta 购物请求由既有 intent 路径学习，不再同时排一份 Observation，避免同一句被算为两个来源。后台 Dreaming 等对话空闲五分钟后才抽取，默认五分钟调度意味着最长接近十分钟；演示可设 `DREAMING_INTERVAL_MS=30000`，使空闲五分钟后在下一次30秒调度内处理，不用手动 flush 冒充定时。明确陈述可上卡，顺口偏好先显示候选。

最新真实手机正向验收在 **2026-10-18 00:21 PDT** 通过：一条机主闲聊在自然空闲 **5分29秒** 后，经真实 Jev 1.14 + gpt-oss-120b 生成 **1 条 `pref.fit=loose` 候选、1 个对话来源**，控制台和另一位个人 agent 的 SDK 读回一致，无新购物意图、无重复贡献、没有提前上卡。详见 [`2026-10-18-phone-gate-retry.md`](../../docs/evidence/2026-10-18-phone-gate-retry.md)。模型来源由正式 API 元数据与 OpenRouter 日志核对。随后已加载 C 的 PR28 界面修正，真实记录不再标成预设学习示例，且显示 gate/extractor 来源，见 [`2026-10-18-phone-controls.md`](../../docs/evidence/2026-10-18-phone-controls.md)；**00:43 PDT** 手机控制闭环也已通过：暂停后普通偏好消息在入队前丢弃；“忘掉 版型”删除当前 fit 候选及其证据、保留原颜色偏好，两端及控制台仍暂停。旧 Git 历史未擦除，未自动恢复学习。手机控制的逐项结果见同一验收文档。

历史边界保留：10月17日首次手机学习有修复前购物误判造成的重复来源，不能充当两段独立对话晋升验收；第二条短裤/长裤偏好被旧门控拒绝，也不算正向通过。B `05a5d8f` 后已把款式/服装长短设计明确归入既有 `pref.style` 提示，松紧归 `pref.fit`，并区分偏好线索与已被确认的偏好；没有新增契约字段或放宽敏感过滤。新门控首次实机尝试因合盖休眠未通过，之后由用户主动重发完成上述成功验收。历史记录未自动重放或改写。

- `暂停学习`：立即停本机队列/中止在途观察，再PUT后台 paused=true；失败明确说“后台尚未确认”。
- `恢复学习`：只在后台明确 paused=false 后恢复本机采集；隔离测试已验证暂停/恢复后的迟到结果被丢弃；后台确认和本机状态更新后才启用采集。
- `忘掉 颜色` / `忘掉 黑色`：只匹配后台真实条目，冻结本地采集后，单次调用 `forgetLearning({field})` 再回读；后台事务暂停并删除该字段的当前贡献，Git 投影失败返回 pending 并禁止恢复。成功只确认当前偏好及证据已移除，明确“旧 Git 历史仍保留”，保持暂停；歧义则请用户在控制台选择。不能把revoke说成完全删除。
- 每日摘要：用户下一次正常交互时，最多附加一次当前有效card状态的结论；不发主动定时短信，不调模型，不含证据原文。暂停时不摘要；读取失败保留正常回复。

可选 `AGENT_COOKIE_LEARNING_OTLP_ENDPOINT` 与 `AGENT_COOKIE_LEARNING_OTLP_TOKEN` 只供独立学习管道的trace/log出口；没有endpoint就不导出。Beta只记录checkpoint与learning_capture的状态/数量；旧Spectrum入口自身telemetry关闭、SDK日志silent。两者均不采集正文日志。已验证本机OTLP，不代表Sentry账号已收到事件。模型凭据由A的后台加载；Photon通道本身不拿OpenRouter模型密钥。
