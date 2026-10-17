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

支持「身份卡」「帮我找双越野跑鞋，120以内，周五前到」「要第二双」「回执」。当前采用有边界的确定性文本识别，**没有调用 LLM**；不声称能处理任意自然语言。所有业务读写都通过 SDK。仅把预算和截止要求放入 intent，不把整张卡发给商家。选择仅映射当前 direct space 已展示的报价，消息中的 userId/agentId/quoteId 不形成授权。

Socket.IO 自动重连最多 5 次，每次用持久 cursor 重新订阅；串行队列上限 128。`.runtime/channel-state.json`（0600、Git 忽略）保存账号绑定摘要、游标、报价和发件箱，最多 2000 条处理记录。运行锁阻止同一状态文件的并发进程；不要另设状态文件启动同一条线路。首次启动从新事件开始，正常重启后从成功检查点恢复。发送前先持久记录，消息 ID 派生幂等 key；不明发送结果会停止并要求人工查看 Photon Activity，不会自动换 key 重发。

`SEND_OUTCOME_UNKNOWN`：先通过 Photon 按原幂等 key/消息核查外发记录。确认已发出后才可把对应 outbox 标为 sent（保留 outgoingId），明确拒绝且未发出才可恢复 ready；不确定时保持停止。异常退出留下 `.lock` 时，先确认该 PID 已不存在，再移走旧锁，保留状态文件。不要删状态文件来“修复”去重。

当前联调使用 `apps/workspace` 的 SQLite 后台，监听 4310，已接真实 rules、Git memory-repo 和 D 的 UCP 录制适配器。Photon 的本地 `AGENT_COOKIE_KEY` 取自 `fixtures/dev-keys.json` 的 `sample-personal-photon` 条目，Desktop 使用不同的 `sample-personal-desktop` 条目。当前 `AGENT_COOKIE_UCP=fixture` 回放商家录制，设置 `AGENT_COOKIE_SAMPLE=1` 保留演示标识；不代表实时库存。`apps/workspace-fake` 仅作为可选内存 fallback；切换后台或重置数据后应重新找鞋，不能复用旧报价。

Demo 同时只做一个购物任务，避免另一个 MCP find 替换当前授权。Sample、未知 ETA、handoff、失败和商家警告都会出现在回复中；handoff 没有链接时明确说明，failed/blocked 带 continueUrl 时保留它。没有实际付款或真实订单。2026-10-17 切换 SQLite 后的两条回复均由 Photon 读回 delivered，测试者确认收到报价与交接链接，见 `docs/evidence/2026-10-17-imessage-sqlite.json`。这不代表真实 UCP 商家已接入。

## 现场演示话术（2026-10-17 定稿）

本轮实机基线是 `docs/evidence/2026-10-17-imessage-real-adapters.json`：14:43 PDT 两次找鞋，14:49 PDT 选择第二双；三条回复均经 Photon 读回 `delivered`，用户确认收到交接链接。它与上段旧桩报价记录是两轮不同的验收。

演示前确认工作台、Photon 监听与 Desktop 使用同一个 4310 后台；只使用已配置的测试对话。保持 `AGENT_COOKIE_UCP=fixture` 和 Sample 标识，不点商家付款按钮。不要为排练重置已取证数据库或删除 Photon 状态文件。需要新报价时重新找鞋；10 分钟授权过期后不能接着选旧报价。

| 拍 | 操作 / 用户原话 | 画面及讲解 |
| --- | --- | --- |
| 1 | iMessage 发「身份卡」 | 显示 Sample、鞋码 42，不显示地址或支付资料。讲：“我不用在每个 AI 里重复填写鞋码。” |
| 2 | 发「帮我找双越野跑鞋，120以内，周五前到」 | 显示两条 Sample 录制报价：Brooks Men's Cascadia 18，$109.95；Keen Men's Wander Trail Running Shoe，$112.00。讲：“工作台按已保存的尺码和这次的预算找报价，数据来自商家录制，现场不保证库存。” |
| 3 | 展示报价尾部 | 两条 `etaDate=null`，显示“到货时间未知”“目前不能保证你要求的到货时间”。不要把用户的截止要求说成商家承诺。 |
| 4 | 发「要第二双」 | 显示 Sample 交接链接及商家返回的登录 / 买家输入提示。讲：“这一步把我交接到所选商家；尚未付款，也未确认订单。” |
| 5 | 发「回执」，同时打开控制台对应 checkout 回执 | 只看商家、字段名、用途和时间。确认 `shipping_address` 只向选中的 Black Flag 商家放行，不能把 Tier 0 回执当作地址回执。 |
| 6 | 完成手机选择后，再在 Claude Desktop 调 `get_my_card`、`find_agents` | 用 `sample-personal-desktop` 身份查询同样需求，保留 Sample。对照新引介的授权与手机 checkout 回执，核对同一家店的 pairwise session。讲：“个人助手换了，同一家商店认出的还是同一位用户。” |

第 6 拍的“店家读 `last_order` 并主动开场”必须有实际商家服务读取和模型回复证据才能展示。当前 UCP proxy 会在 handoff 时写 `last_order`，但这不等于已付款，也不等于商家模型已经读到它。不要让 Claude 根据提示代写“欢迎回来”冒充商家输出；缺少这条链路时，只展示已核对的 session 连续性，并说明商家开场尚待接通。

## 失败与交接文案

以下是当前 `src/agent.ts` 的实际输出规则；尖括号是后台返回值，不是额外编造的商品、地址或链接。商家原话可能是英文，应保留其真实含义。

| 返回 / 情况 | 手机显示与讲解 |
| --- | --- |
| `handoff`，有 `continueUrl` | `[Sample 演示] 已准备好所选商品的交接链接：<链接>`，随后显示后台提示和“尚未付款，也未确认订单。此结果仅供演示。”登录受限属于交接，不播报购买成功。 |
| `handoff`，无链接 | `[Sample 演示] 商家需要继续处理，后台未提供交接链接。`，保留后台提示及未付款 / 未确认订单说明；不猜一个 URL。 |
| 选择时商家明确报告售罄 | 按后台 `failed` 显示 `[Sample 演示] 本次操作失败：<商家售罄说明>`；有后续链接时保留，并说明“未确认订单或付款”。讲：“所选商品已无法完成这次交易，请重新找鞋。”只有明确的商家售罄证据才能这样讲。当前两家 fixture 是登录受限链路，未取得售罄的实机证明。 |
| 搜索返回零条报价 | “没有找到符合条件的报价。”不把零结果自行解释成售罄，也不显示第二双选择提示。 |
| 后台返回 `failed / UPSTREAM_ERROR` | `[Sample 演示] 本次操作失败：<后台公开说明>`；如提供 `continueUrl`，显示“后台提供的后续处理链接”和未确认订单 / 付款说明。不得把失败包装成 handoff 成功。 |
| 网络或未知异常 | “后台暂时无法完成请求；未确认新的订单或付款。请稍后查看回执再重试。”不回显原始异常、路径、密钥；先查回执和 Photon Activity，不重复提交不确定的交易。 |
| `blocked` | `[Sample 演示] 暂时不能继续：<后台拒绝原因>`；权限拒绝不伪装成商家故障。 |
| 失效报价或撤销授权抛错 | “这次报价已失效或权限已撤销，请重新找鞋。”若后台返回 `blocked` 结果而非抛错，则沿用上一行和后台原因。 |
| `ordered` | 仅后台明确返回此状态及订单 ID 时显示“后台确认订单”；Sample 仍须保留。当前 fixture 演示预期是 handoff，不能提前承诺 ordered。 |

Photon `SEND_OUTCOME_UNKNOWN` 属于通道发件状态，不是订单状态。按上文恢复流程人工核查，不删除去重状态、不更换幂等 key 重发。上述失败文案有代码与隔离测试覆盖，但不能替代真实商家售罄 / 上游失败录制的端到端验收。

## 合并后的 SDK 与依赖检查

控制台写方法 `revokeGrant(id, options?)`、`revokeContribution(id, options?)`、`demoReset(options?)` 已在 `@agent-cookie/sdk` 中实现，支持 `AbortSignal`；`demoReset` 只用于明确授权的 owner 演示重置。验证这些写方法使用隔离测试，不操作当前手机演示数据。

B 包的内部依赖声明使用 `workspace:*`，统一从仓库根执行 `pnpm install --frozen-lockfile`。根 `pnpm-lock.yaml` 的 `version: link:../sdk` / `link:../../packages/sdk` 是 pnpm 正常生成的本地解析值，不应手动改成 `workspace:*`，也不建立 B 包独立锁文件。
