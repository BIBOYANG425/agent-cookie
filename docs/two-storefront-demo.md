# 一条真实 UCP 链路与两个 Sample shopping agent

2026-10-17 侧聊方案已转达本主聊：优先做一个真实 UCP 商家集成，加两套独立部署的 Anthropic customer-facing **shopping agent**。复用一份接入实现，推迟现场“coding agent 安装一切”环节。本记录落实 C 线的协作和证据边界，不替代或修改 `docs/plan.md`，不新增契约。

这项方向替代 C 线此前“blueprint 只作可砍的 P1 素材”的建议。正式验收编号、标题和 P0/P1 等级仍沿用已发布 v0.3，变更由人同步计划；不能因为改了演示结构就把未执行项目标通过。

用户随后明确选择使用 blueprint **原有通用商品**，不新增 Sample 跑鞋商品。两家展示语言、语气、当前任务预算与各自关系 note；不再把“原版按 42 码报鞋价”作为这两店已具备的行为。原 A15 的标准仍待人同步。通用商品店不能擅自新增 `retail` Category，当前契约仍只有 `personal | shoe`；注册能力与演示意图的匹配由 A 线确认。

## 三个参与者分别证明什么

| 参与者 | 数据与动作 | 证据 |
| --- | --- | --- |
| Sample 店 A 的 shopping agent | 在自己的进程中用被允许的上下文进行真实模型对话 | 工作台读取回执、实际模型 turn、自己的 pairwise ID 与 note |
| Sample 店 B 的 shopping agent | 同一份实现、独立部署与凭据 | 与 A 不同的 pairwise ID；A 的 note 不可读；独立可撤销 |
| 一个真实 UCP 商家 | 真实商品、库存和 cart | 新鲜 UCP 响应与商家/variant/cart 来源；不能用 Sample 报价当真实商品成交 |

Anthropic 仓库里的 **merchant agent** 是工作人员使用的后台助手。这里使用顾客对话侧的 **ShoppingAgent**；`examples/retail/api/main.py:40` 是该侧的 memory 注入点，`:63` 的后台 memory 不是本演示接入目标。

现有 `fixtures/ucp/recording/` 两家真实商家的历史实录完整保留。演示只需选一条真实 UCP 链路；这不等于修改现有 A09 中的两商家匹配标准。由人确认新的演示序列与原验收之间的对应。

## 同一实现，两份状态

每家拥有单独的工作台 merchant key、merchant agentId、服务进程、外部 clone/data 目录和上游会话表。Agent Cookie pairwise ID 必须由工作台生成，不能用随机浏览器 session token 代替，更不能由模型提交的 userId 授权。两家可以共用模型提供方账号和只读代码，但不共用工作台 merchant key 或可写记忆文件。

默认基础服务地址为 A `127.0.0.1:8000 / :3000`、B `127.0.0.1:8001 / :3001`。启动器遇到占用应失败，不自动复用旧服务或换端口，避免两个窗口实际连到同一家。两边 Python editable 模块也必须指向各自 clone；只换端口而仍 import 同一个 DATA_DIR 不算独立部署。

顾客浏览器不能选择工作台 key。工作台凭据只注入对应商家后端，不进入 `NEXT_PUBLIC_*`、前端 bundle、URL、录屏或日志。上游 `POST /api/session` 的任意 demo user_id 不是工作台授权；真实接入必须由受信 host 把上游 session 绑定到工作台已介绍的 pairwise ID，拒绝未绑定主体。

## 真实接入的最小出口

1. 工作台为 A/B 分别介绍并授权；两店分别用自己的凭据读取获准字段。模型回复可以使用读到的内容，个人 agent 不把整张卡粘贴进消息。
2. 同一实现为每店读写自己的关系 note。不能用两份本地 JSON memory 的不同结果冒充工作台 note 隔离。
3. 撤销 A 后触发一次新的工作台字段读取，记录 `GRANT_REVOKED`；同一时刻 B 的有效授权仍可读。检查的是新读取权限，不声称模型忘记聊天历史中已经收到的值。
4. 换另一个 personal agent，介绍同一用户给 B；展示同一个工作台 pairwise ID，并让 B 读取自己的关系 note。个人 agent 不去读取 B 的 note。
5. 真实 UCP cart 单独展示实际商家与 variant。Sample 商品和价格不能被当作真实库存、购买或交付承诺。

纯文本前缀只证明首轮上下文投递；网页健康检查只证明进程可用；HTTP 200 的 SSE 也可能只含 `error`。以上都不替代真实工作台调用与完成的模型 turn。上游 memory 提取在回复后的后台运行，`turn_complete` 本身也不证明 note 已写入；必须实际读回或核对写入回执。完整证据要求见 [双店证据说明](evidence/two-storefronts-and-ucp.md)。

## 实施顺序和当前状态

先完成双实例脚手架与源代码接入点核对，再在一家实现冻结契约下的工作台边界；该路径通过后将同一实现配置给第二家，最后完成双店隔离、撤销、回头客和 UCP cart 的实际演示。现场 coding agent 安装段后置，A16 保留待办。

当前 `lane-c` 没有冻结 v0.3 core、SDK 或 fake workspace。`origin/main@d48e263` 已合入 v0.3 文档，`origin/lane-a@1537c83` 仍为预契约，`origin/lane-b@7da6659` 尚无 SDK。本地 `docs/plan.md` 保持原样，合入工作区仍由人操作。两店真实模型聊天还需要可用的 Anthropic 凭据；上次实测返回凭据缺失错误。

MemoryStore 的六方法、seed、单条删除与 purge generation 问题仍需处理。可以评估先在受信 host 做每轮上下文加载和获准关系 note 读写，但必须保留原写过滤、明确关闭未接入的持久化路径，并通过真实 HTTP 证据验收；不能用空方法或本地 fallback 绕过工作台拒绝。具体实现要等 A/B 冻结载荷与授权绑定，不在文档里发明接口。
