# Tier 2 参考实现的交付门槛

本目录用于验收 skill 生成的实现，不是用户接入时复制的代码。目前没有 `agent_cookie_memory_store.py`：冻结契约和 fake workspace 尚未交付，不能制造一个看似能跑的参考答案。

新双店方向可以先用现成的偏好加载与 save_memory / recall_memories 工具接缝完成有限关系 note 接入，而不实例化 MemoryStore。这样不需要先解决全部六方法，但不等于本目录的完整参考实现或 A16 通过；详见 [最小接入边界](../../examples/blueprint/INTEGRATION.md)。

真实上游 `anthropics/commerce-agents@fd4d59224ab96b43c6dc6888207c67b3bd5a24cf` 的 MemoryStore 要求六个方法；细节见 [blueprint 接入地图](../../skills/add-agent-cookie/references/commerce-agents.md)。实现前需 A/B/C 确认：

| 未决项 | 影响 |
| --- | --- |
| 字段/note/contribution 的完整请求、响应、认证与幂等契约 | `httpx` 不能仅根据端点名字猜载荷 |
| note 的键结构、单次/总大小、失效时间、缺失返回与可枚举性 | get/search_facts 需要确定如何构建完整 MemoryFact 集合 |
| 单条删除、clear 与 purge generation | 上游有删除 UI 和防止并发提取复活的检查，计划没有相应 API 语义 |
| 卡字段被呈现在 memory 后的删除/清空语义 | 商家不可借 memory 清空共享卡；重新读卡也不能伪称“已忘记” |
| 写入 field/basis 的确定性来源映射 | 上游 MemoryFact 的 category/source tag 不等于 `observed` 证明 |
| 受信 host 的 pairwise ID 映射、上游聊天 session 与启动 seed 处理 | 原版 user_id 是 demo 参数，不能据此授予工作台权限 |

这些是需求，不是新契约。主代理统一记录到 `docs/requests.md`，由对应线给出决定。补齐后才实现并用 HTTP 测试范围、隔离、删除、到期、撤销、过滤与失败行为；不把方法数或 80 行当作验收标准。A16 仍需独立干净克隆的真实 skill 运行证据。
