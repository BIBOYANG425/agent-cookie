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

本机 Sample 后台没有持久化，重启后旧报价会失效；重新找鞋即可。Demo 只做一个购物任务，避免另一个 MCP find 替换当前授权。Sample、未知 ETA、handoff、失败和商家警告都会出现在回复中。没有实际付款或真实订单。真实手机购物流程的验收要另有设备回执，不能用旧 ping 或自动测试冒充 A17。
