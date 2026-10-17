# Photon iMessage — 本地脚手架

本包提供离线 Sample、配置检查，以及真实通道的限时 ping 探针。运行者需在 Photon 控制台准备项目和共享 iMessage 线路，把凭据保存在本机、被 Git 忽略的 `.env` 中；仓库不含可共用的凭据或测试者身份。

## 不需要账号的本地检查

使用 Node 22.12 以上的 22.x，在仓库根运行：

```sh
pnpm --dir apps/channel-photon install --ignore-workspace --ignore-scripts
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

官方新手流程也是限时轮询；持续购物 agent 后续应切到 [Socket.IO 事件流](https://photon.codes/docs/beta/websocket/events)，处理持久游标与去重。Socket.IO 的 webhook reply 与真正发 iMessage 是不同操作；本探针用 `projects.sendMessage` 发消息。

## 下一阶段

完成当前运行环境的一收一发验证后，再把 B 线 SDK 的 intent/quote/accept 链路接到通道。当前没有接模型、没有搜鞋或下单，也不算 A17 通过。通道身份与工作台用户/钥匙的绑定必须来自配置，不能听从消息内容里的 userId。
