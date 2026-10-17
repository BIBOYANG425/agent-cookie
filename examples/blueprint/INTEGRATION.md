# 双店共用的接入边界

目标：两家使用同一份 Messages API `ShoppingAgent` 接入代码，各自独立的工作台 merchant 身份、pairwise session 与关系 note。用户已选择保留上游通用 Sample 商品。A 的正式契约 `bd9d6e3` 已可读，尚未合入 main；下文是接入设计和已完成的独立协议组件，不是可运行的授权实现。

## 已有的共享组件

`storefront_transport.py` 实现固定上游已有的 session/chat HTTP 协议：显式创建主体会话，核对返回主体，以 `X-Session-Id` 调 chat，解析 SSE。它不接收工作台钥匙，也不提供新的 HTTP 端点。调用者必须先由受信 host 校验工作台介绍与授权；不能把任意传入的 user_id 当作授权。

每个 client 绑定一个 loopback origin；聊天 token 不能跨 origin 使用。同一 session 的 HTTP 流串行，不自动重试 chat POST，不跟随重定向。上游 `host.py` 在响应结束后的 `BackgroundTask(write_back)` 才保存 history，客户端收到 EOF 并不保证保存完成；正式接入需要服务端把读历史、推理、写回置于同一会话锁内。当前客户端锁不是 history 或 note 的同步屏障。`StorefrontError` 只输出诊断码，不包含 token 或上游消息正文。

- HTTP 非 2xx：`http_<status>`。
- HTTP 200 SSE 含 error：`upstream_error`。
- 断流/没有 turn_complete：`incomplete_turn`。
- JSON/事件体不符合实际上游协议：`invalid_sse`。
- `turn_complete` 仍可能是 token 上限或工具循环结束；调用者检查 `stop_reason`，`max_tokens` 时 `is_truncated` 为真。缺失或非正常的 stop reason 不能按完整模型回复验收。
- 流结束仍保留 tool_result 的 error/blocked，调用者检查 `has_failed_actions`。即使 `stop_reason == "end_turn"` 且没有工具错误，也不证明 note 已写入，仍需实际读回或写入回执。

`StorefrontTurn.events` 保留 ui、usage 和未知事件，供调用者按实际协议处理；不要把它不经脱敏直接写日志。此组件未 wired 到上游，不会让原版 memory 自动走工作台。

离线单元测试：

```sh
/tmp/agent-cookie-commerce-agents/.venv/bin/python -m unittest discover -s examples/blueprint/tests -v
```

测试只使用明确的 transport fixture；它们不计入 `tests/acceptance`，不证明真实模型或工作台集成成功。

## 比完整 MemoryStore 更小的首版

不必先实现六方法 MemoryStore。可以用上游现成的偏好加载接缝，以及已有的 save_memory / recall_memories 工具执行路径，先接工作台实际字段和关系 note。不得新增工具名或伪装残缺 MemoryStore。

| 接缝（固定上游 fd4d592） | 首版应做什么 |
| --- | --- |
| `ShoppingAgent` 的 `backend.get_preferences(session)` | 从本店工作台授权范围加载当前上下文；共享卡字段为权威值，不被关系 note 覆盖 |
| 受信 host 的模型调用前 gate | 先验证绑定与当前读取权限；被撤销就明确失败，不能落回旧 history 继续冒充读取成功 |
| `executor_class` 中已有 save_memory / recall_memories | 保留原写过滤与字段限制；只读写本店获准的关系 note，不把文本事实自动声明为 observed |
| 原持久 memory / extraction / seeder | 首版显式关闭未接入的路径；不向全局 `.memory-store.json` 或 `demo-user` 写种子，不后台双写 |
| 商品 backend 的 preferences/orders/account | 保留公开 Sample catalog；检查并关闭不需要的 demo profile、会员与订单默认来源 |

上游 `_prefetch` 会吞掉 get_preferences 的异常继续推理，所以仅让该方法抛 403 不足以保证调用行为。模型前 gate 和每次工具的工作台校验都需要实现。撤销只阻止新读取，不能收回历史里已经传出的内容。

首版的取舍必须显示清楚：有真实工作台字段读取和有限关系 note 工具；没有通用 memory 搜索/删除/清空/自动提取，不声称完整六方法接入或 A16 通过。若继续完整 MemoryStore，再补原删除/clear/purge generation 语义及并发保护。

## 在另一家重用，而非复制适配代码

A/B 后端配置分别提供商家凭据和稳定身份。应用模块与 adapter 相同，实例间不共享可写上下文、缓存或 token。新的 personal agent 访问 B 时，新建聊天 token、清空旧 transcript，再由 B 读工作台 note；这样连续性来自关系存储，不是模型旧聊天。

两个非 UCP 店面不得填同一个 localhost domain 作为 merchantKey。使用不同稳定 agentId 的规则与 seed/reset 由 A 冻结。不要在下一轮撤销验证前自动 find/介绍，否则可能获得新 grant，掩盖被撤的旧授权。

## 已知契约与剩余边界

A `packages/contract` 和实际路由已提供字段、note 读写与错误载荷；note 读写使用 merchant key + sessionId，并受当前 grant 检查。仍需完成受信 host 的介绍/session 映射、两店独立凭据与授权 gate、SDK 替换、auto 放行回执关联和真实调用验证。不能把已存在的类型与路由当作已接通。

完整 MemoryStore 还缺商家 HTTP 的 note 删除、枚举、clear、持久 generation 和条件写入语义，以及 MemoryFact 编码与跨层 2048-byte 限额的一致定义。内部 `MemoryRepoApi.deleteNote` 不构成新的商家权限。[六方法内存参考](../../fixtures/expected/README.md) 可用于隔离/过滤/删除语义的离线验收；它的 HTTP port 明确拒绝启用，不会回退到本地事实冒充工作台成功。跨线请求由主代理统一记录。

TypeScript 工作台调用通过 B 的 SDK；计划特许的 Python blueprint 调用可以使用 httpx 按冻结 HTTP 契约。两种方式都不能读 SQLite 或用户 git 记忆库。
