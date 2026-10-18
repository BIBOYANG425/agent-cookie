# Agent Cookie · 3–5 分钟视频分镜

2026-10-17 T9-3。目标 **4:30**，遵循 [plan 第3节](plan.md) 的 iMessage → 报价 → 选择 → 授权 → 换 agent → 架构顺序；按人的后续裁决删除 ACME/Tier 0 一拍。plan 不改。本稿是拍摄安排，**不是完成视频**；文件是否可用以[证据索引](evidence/README.md)为准。

## 开场前选一条真实需求

现场优先使用本人当时真正需要的东西；以下是三条备选，不要求特定店名、价位结果或尺码。预算只属于这次请求。不能为凑库存而临时改卡上的尺码。

| 编号 | 可直接说的需求 | 对应完整 Recorded run 目标文件 | 当前状态 |
| --- | --- | --- | --- |
| R1 通勤 | “最近每天走路通勤，帮我找双舒服的日常走路鞋，95美元以内。” | `recordings/R1-commute-imessage.mp4` | 仅有[历史 catalog 材料](evidence/recorded-needs/README.md)，尺码未核对；完整原片待 B |
| R2 外套 | “帮我找件轻便外套，这次 M 码，150美元以内。” | `recordings/R2-jacket-imessage.mp4` | 通用文本入口已有；该句的实时商家链路和完整原片待 B |
| R3 背包 | “周末短途出门，帮我找个轻便背包，80美元以内。” | `recordings/R3-daypack-imessage.mp4` | 该句的实时商家链路和完整原片待 B |

上表文件名均相对 `docs/evidence/`，当前不表示文件已存在。R2 明确演示本次尺码覆盖默认；R3 无适用尺码，不向背包硬套鞋码。补全的是**适用**的卡字段；尺码体系或品类含义不清时追问或说明。Fixture 模式可能仍返回旧鞋款，不能把它配到外套/背包台词下。

## 画面约定

主画面左侧手机 iMessage，右上控制台，右下工作台终端；读小字时放大对应区域。标签贯穿全片：`Live` 只指本次实时结果；`Sample` 指演示身份/数据；`Fixture replay · captured <UTC>` 指录制商家响应；插入旧片始终标 `Recorded run · <UTC> · <数据模式>`。真实消息通道与 fixture 商家可以同时存在，不能合成一个“全实时”标签。

新素材默认存 `docs/evidence/recordings/`。下面 `RR-xx` 是待录文件名，现有 JPG/MP4 则链接到真实文件。没有合格文件时执行“缺片处理”，不生成预期消息或仿制终端。

## 主分镜 · 4:30

| 时间 / 拍 | 屏幕上是什么 | 台词一句 | Recorded run 兜底 / 缺片处理 |
| --- | --- | --- | --- |
| 0:00–0:20 · S01 认识用户 | 控制台卡片：语言、偏好、适用尺码及真实来源，地址只显示字段名；说明当前 Sample/Live 模式 | “Agent Cookie 让下一个 agent 在第一条消息前，拿到这次任务允许的上下文。” | `RR-01-console-card.mp4` 待 C；现有 [sample-card.jpg](evidence/console/sample-card.jpg) 可作明确标 Sample 的静态解释 |
| 0:20–0:45 · S02 一句话 | iMessage 连续原片中输入 R1/R2/R3 之一；保留原需求、本次预算及必要追问，不删掉用户额外提供的条件 | “我只说这次需要什么，已经知道而且适用的偏好由卡片补上。” | 对应 `R1-commute-imessage.mp4` / `R2-jacket-imessage.mp4` / `R3-daypack-imessage.mp4`；均待 B，缺片不称完整主线完成 |
| 0:45–1:10 · S03 两家报价 | 手机实际商品、价格、尺码说明和来源；终端显示真实 UCP 查询及内部商家代理 session 的区别 | “工作台最多找两家，价格不超过本次预算，每家在工作台里有自己的会话。” | 同一条 `R*-*-imessage.mp4` + `RR-03-workspace-search.mp4`（A）；实际只有一家或零家必须说明，未知 ETA 不补造 |
| 1:10–1:30 · S04 商家申请（可选） | 控制台商家旁真实 `needs_declared.object`；若确为5/4/1，显示“5 requested / 4 grantable / 1 denied”，不可用字段为灰标签 | “这里区分商家想要什么，以及工作台实际允许它得到什么。” | `RR-04-console-needs.mp4` 待 A/B 接线后 C 录。缺真实 owner 投影或 SDK kind 透传就跳过；[Sample 图](evidence/console/sample-grants.jpg)只可作为界面设计补充，不能配实连成功台词 |
| 1:30–2:00 · S05 选定与交接 | 有第二双鞋才说“要第二双”，其他品类用“选2”；显示真实 handoff/failed/blocked，回执列出实际用途与字段 | “选定后才进入这家的 checkout；这里给的是继续处理链接，尚未付款。” | 同一条 `R*-*-imessage.mp4` + `RR-05-workspace-checkout.mp4`（A）+ `RR-05-console-receipts.mp4`（C）；无链接不说有，真实 live 使用 Sample 地址时可能直接交接且没有地址放行，不强造回执 |
| 2:00–2:25 · S06 授权与撤销 | 控制台展开字段/期限；撤销另一家的 grant；终端显示该商家后续读取被拒绝。回执只列字段名，不展示地址值 | “授权按商家分开、有期限，撤销后新的读取会被拒绝。” | `RR-06-console-revoke.mp4`（C）+ `RR-06-workspace-denial.mp4`（A）；不声称收回已传数据，无 contribution ID 不假演逐条来源撤销 |
| 2:25–2:50 · S07 换个人 agent | 完成手机选择后再切 Claude Desktop：真实 MCP 查询，同店内部 pairwise session 与手机那次一致；其他商家不同 | “换了个人助手，工作台仍认得与这家商店的关系。” | `RR-07-desktop-return.mp4` 待 B；现有 [Desktop 图](evidence/2026-10-17-claude-real-adapters-card-quotes.jpg) / [同店证据](evidence/2026-10-17-postmerge-b-verification.md)可作注明日期的静态解释。没有商家模型主动问候证据，不配“上次那双”回复 |
| 2:50–3:35 · S08 随口偏好→学到的 | 手机说本人真实、不敏感的偏好，例如“周末又去徒步，上次脚湿透了”；保留连续原片时间戳。剪到自然安静五分钟后的下一次调度，控制台显示实际候选/上卡、来源及模型链，再看同候选集报价排序 | “随口提到的偏好先成为有出处的候选，是否上卡由规则决定。” | `RR-08-phone-learning.mp4`（B）+ `RR-08-console-learned.mp4`（C）+ `RR-08-quote-ranking.mp4`（B）。**C20 缺片**；这句话可能只表示经历，gate 若拒绝就如实显示不学习。不得把同一句的 intent 和 conversation 算两源；不得用手动 flush 或测试时钟冒充五分钟 |
| 3:35–4:00 · S09 用户持有的记忆 | 展示 MEMORY.md Index、stock skill 新会话读回、工作台自管四路径及 A23 结果；快速给出 A16 Claude Code / Devin 证据入口，不再展示 ACME 聊天 | “原版记忆 skill 仍能读写自己的文件，工作台负责受管字段和权限。” | [A23 新会话截图](evidence/A23/claude-new-session-recall.png)、[Claude Code 执行片段](evidence/A16/claude-code-contract-check.mp4)、[Devin HTTP 实跑](evidence/A16/devin/devin-http-realtime.mp4)；注明旧录制日期与片段范围，A16收口不等于C11全部接口完成 |
| 4:00–4:30 · S10 架构与下一步 | README 架构及当前范围标注、证据索引、项目链接；图中旧 ACME 节点注明已砍，不放入现行主线动画 | “Photon 承载对话，UCP 连接商家，Agent Cookie 管理上下文的来源、用途和期限。” | `RR-10-architecture.mp4`（C，待录）；可直接展示仓库文档。字幕下一步：needs 接线、webhook 硬化、手机 passkey、支付；标“计划” |

## 缺片剪辑与时长

- needs 未到：删除 S04 的20秒，后续顺移，成片 **4:10**。
- C20 未补齐：把 S08 的45秒改为20秒的**已验证范围说明**：展示 [真实模型六场景报告](evidence/2026-10-17-learning-live.md)，台词“真实模型六场景已通过；干净的手机正向学习与排序仍在补证”。字幕保留“合成输入 / 隔离 SQLite+Git / fixture commerce”，不展示旧误计双源结果作为成功。此时完整稿 **4:05**；同时去掉 needs 则 **3:45**。
- 主线 UCP 失败：先保留失败，再切到**已存在且核验过**的同需求 Recorded run；如果换另一需求必须展示那条原话和预算。旧 catalog JSON 可解释协议，不能替代手机完整录像。没有任何完整 A17 原片时，只能交标注未完成的技术演示，不能宣布正式3–5分钟产品视频已完成。
- A16 片段可用于 S09 的支撑，但原版 Tier 0 首回已经砍掉，任何短版都不恢复 A15。

## 每拍的性质核验

录制前记录代码 SHA、UTC、数据模式与相关卡字段；一次只做一个购物任务，Desktop 不与手机未完成的选择并发，避免替换当前授权。每条报价核对：不同商家数≤2、价格≤本次预算；尺码不匹配/未知保留说明。地址如被放行，应只给已 accept 商家且 purpose=checkout；没有放行就陈述事实。

学习片保留真实等候的起止时间，成片用“约五分钟后”的清楚切点压缩时间；原片不得重排。一次候选来源仍是一次，不为了上卡补造第二段。排序比较使用同一候选集合、相同显式预算/条件，保留排序前后与依据；没有变化也是实际结果，不能改商品名或价格制造变化。

由提供原片的线在入库前遮盖密钥、手机号、完整地址及能力链接中的 token；保留可关联的脱敏 ID、字段名、状态和时间。现有 `docs/media/` 由用户持有，本轮未核验或覆盖，不能自动算兜底。最终输出目标1080p，以手机文字和回执正常可读为准。
