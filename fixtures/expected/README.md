# Tier 2 验收参考：六方法 Sample 内存 port

本目录用于对照 skill 生成的实现，**不是用户接入时复制的交付代码**。[agent_cookie_memory_store.py](agent_cookie_memory_store.py) 已提供完整六方法的确定性内存参考；它没有接到工作台或双店服务，不是 A16 通过证据。

上游基线为外部克隆 `anthropics/commerce-agents@fd4d59224ab96b43c6dc6888207c67b3bd5a24cf`。测试直接导入该安装的 `MemoryFact`、fence、filter、`check_memory_store` 和 `extract_and_store`，没有复制第三方源码进本仓库。正式工作台契约已核对 A `bd9d6e3` 的 `packages/contract/src/{types,policy,apis,endpoints}.ts`；已随 main `798e0de` 合入。当前阻塞是下面列出的商家 HTTP 能力缺口，不能再归因于契约文件未到。

## 已实现、已验证的范围

- `AgentCookieMemoryStore` 实现上游六个 async 方法：get、upsert、search、delete、clear、purge generation。
- 商家身份固定在实例配置，受信 host 的 subject→pairwise 映射复制后只读；未知主体（包括默认 `demo-user` seed）明确拒绝。两个商家共享测试 port 时仍按商家与 pairwise 双维度分区。
- 仅接收 host 明确允许的关系 key 和 `context` 类别。标准身份卡字段禁止作为这些 note key；不创建 observed contribution，不缓存共享卡。这个结构白名单不等于通用语义分类器，真实部署仍需审核关系事实的来源和内容。
- 复用原版 fence、规范化、长度模型和自定义 filter；默认标识符过滤不能被移除。来源只接受上游生成的 session tag，不接受原始聊天凭据。原始时间戳保留；缺失时间戳使用注入的时钟。
- 整批验证成功后才写入；输入/返回的 MemoryFact 都不会暴露内部可变引用。每次 port 操作检查注入的 Sample 授权 gate。这个 gate 不是工作台鉴权实现。
- 单条删除如实返回 bool。按上游语义，只有 clear 递增该 scope 的 generation，空清除也计数。一个异步锁只保证本进程内 port 操作串行。
- `UnconnectedWorkspaceMemoryPort` 在构造完整 store 时以及全部六种操作时抛出 `ContractUnavailable`，错误标明 `TODO(contract)`；不会空操作返回成功，也不会切换成本地数据。

```sh
# 使用已安装固定上游的外部虚拟环境；从 Agent Cookie 仓库根目录运行。
/tmp/agent-cookie-commerce-agents/.venv/bin/python -m unittest discover -s fixtures/expected/tests -v
```

当前 13 项离线测试覆盖双商家/双主体隔离、不可变绑定、未绑定主体、搜索和替换、默认及自定义过滤、fence 与时间、禁止卡字段混入 note、来源 tag、删除与 generation、每次操作重新检查 Sample 授权，以及未接通 HTTP 的显式失败。

2026-10-17 已在重新建立的外部固定克隆上复测：Python 3.11.15，13 tests / OK，compileall 通过；上游 commerce-common 从固定 commit 的源码安装。复测未请求模型、工作台或商家网络服务。

其中并发测试使用上游真实 `extract_and_store`，在明确的模型 fixture 等待期间 clear，再放行模型 fixture，确认旧提取结果不写回。它没有调用 LLM API。**这不证明单条删除不会复活，也不证明跨进程条件写入**：原版 delete 不递增 generation，提取流程的最后一次 generation 检查与 upsert 仍是两个操作。不能夸大这项测试的保证。

## 仍需 A 冻结或补齐的商家 HTTP 能力

| 边界 | 当前事实与缺口 |
| --- | --- |
| 单键 note HTTP | 已有 `GET /agent/notes/:key?sessionId=` → `{key,value,updatedAt,expiresAt}`；`PUT` 接收 `{value:string}` → `{key,updatedAt,expiresAt}`。Bearer merchant key；实际路由会检查当前 session/grant。这个参考尚未实现 HTTP transport。 |
| 全量读取/搜索 | 没有 note 枚举接口。需要确定完整 MemoryFact 集合的键方案、编码及元数据；已知键的单次 GET 不自动等于完整 get_facts。 |
| 删除与 clear | 商家 HTTP 没有对应能力。内部 `MemoryRepoApi.deleteNote` 不能从商家直接调用；不能用空字符串 PUT 或 `/demo/reset` 替代删除。 |
| generation/并发 | 缺持久 generation 与原子条件写入或等价同步契约；客户端内存计数无法覆盖多实例、重启和最后检查后的并发删除。 |
| 2048 字节 | `services/notes.ts` 按全部 `[key,value]` JSON 的 UTF-8 字节计算；MemoryRepoApi 按完整渲染文件计算。需统一并明确 MemoryFact 编码开销及批量失败语义。内存 fixture 不冒充已实现 HTTP 容量/TTL。 |
| 共享卡事实 | 尚无 MemoryFact 读取映射、删除/清空的产品语义及确定性的 field/basis 来源映射。本参考只处理本商家关系 context，不能当作完整身份卡适配。 |
| 受信 host | 仍须完成介绍→pairwise→上游 user_id 的绑定、模型调用前授权 gate、关闭默认 seed 与本地 memory fallback。仅替换 main.py:40 不够。 |

跨线请求由主代理记录，不在这里创造端点或 SDK 方法。TypeScript 继续使用 B 的 SDK；项目允许的 Python HTTP 实现待这些语义补齐后使用 httpx。服务启动、离线参考测试、真实 HTTP 验收、模型聊天、干净克隆 skill 运行和录屏分别记录；目前没有后三项证据，A16 未通过。
