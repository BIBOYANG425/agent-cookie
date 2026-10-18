# Recorded run 素材清单 · T9-4

2026-10-17。对应 [4:30 分镜](../video-storyboard.md)；清单完成不等于录制完成。所有待录路径只是交付目标，**没有创建占位视频**。现有素材按原录制范围使用；A15 已砍，不再向任何线索要 ACME Tier 0 首回。A16 已按人的裁决通过。

归属：**B = iMessage/Photon 原片、Claude Desktop、手机学习与报价；A = 工作台/UCP 终端及服务端核验；C = 控制台、记忆库材料、剪辑与索引。** 新的跨线缺片请求已追加 [requests.md](../requests.md)。C11 保持 BLOCKED；C20 仍未勾选。

## 逐拍文件

下表的新文件都在 `docs/evidence/recordings/`，完整目录名列在反引号里。`待录` 不表示已有文件；现有文件使用可点击链接。

| 拍 / 对应画面 | 文件 | 归属 | 状态与范围 |
| --- | --- | --- | --- |
| S01 身份卡 | `recordings/RR-01-console-card.mp4`；[sample-card.jpg](console/sample-card.jpg) | C | 新通用 Sample 截图已录；视频待录。实际来源不能用 Sample 来源替换 |
| S02–S03–S05 R1 通勤完整原片 | `recordings/R1-commute-imessage.mp4` + `recordings/R1-commute-metadata.json` | B | 待录；从原话到实际结果连续保存，历史 walking catalog 只是辅助 |
| S02–S03–S05 R2 外套完整原片 | `recordings/R2-jacket-imessage.mp4` + `recordings/R2-jacket-metadata.json` | B | 待录；不得将固定鞋款 fixture 换名为外套 |
| S02–S03–S05 R3 背包完整原片 | `recordings/R3-daypack-imessage.mp4` + `recordings/R3-daypack-metadata.json` | B | 待录；非尺码商品不套用 shoe_size |
| S03 工作台真实搜索 | `recordings/RR-03-workspace-search.mp4` | A | 待录；与某一 R1/R2/R3 同次运行，保留实际模式/商家数量/尺码提示 |
| S04 needs | `recordings/RR-04-console-needs.mp4`；[sample-grants.jpg](console/sample-grants.jpg) | A/B 接线，C 录屏 | 仅 Sample 截图可用；真实 needs 事件和 owner unavailable 投影未到，不入实连成功片 |
| S05 checkout 过程 | `recordings/RR-05-workspace-checkout.mp4` | A | 待录；cart/checkout/实际结果，地址仅在真实放行时展示字段名与目的 |
| S05 回执 | `recordings/RR-05-console-receipts.mp4`；[sample-receipts.jpg](console/sample-receipts.jpg) | C | Sample 新截图已录；真实同次回执录屏依赖 A/B 主线 |
| S06 撤销 | `recordings/RR-06-console-revoke.mp4` | C | 待录，与 A 的拒绝片同次；不能只拍 Sample 后说真实商家被拒 |
| S06 拒绝结果 | `recordings/RR-06-workspace-denial.mp4` | A | 待录，实际商家授权撤销后的读取结果，不拼接其他实例 |
| S07 Desktop 回头客 | `recordings/RR-07-desktop-return.mp4`；[Desktop 查询图](2026-10-17-claude-real-adapters-card-quotes.jpg)、[同店图](2026-10-17-postmerge-same-session.jpg) | B | 历史截图已存，连续视频待录；只证明卡片/MCP/同店 session，不证明商家模型问候 |
| S08 自然手机学习 | `recordings/RR-08-phone-learning.mp4` + `recordings/RR-08-learning-metadata.json` | B | 待干净新 gate 正向原片；真实五分钟空闲，不能 flush/clock；先前误计双源、gate 停止记录保留为历史 |
| S08 学到的 | `recordings/RR-08-console-learned.mp4`；[模型来源 Sample 图](console/sample-learned-models.jpg) | C | Sample 截图已录；真实 contribution/evidence/models 与 B 同次运行对应后再录 |
| S08 排序 | `recordings/RR-08-quote-ranking.mp4` + `recordings/RR-08-ranking-metadata.json` | B，A 协助数据核对 | 待录；相同候选集、相同显式条件，比较偏好生效前后；没有变化如实说，不强造成功 |
| S09 A23 新会话读回 | [claude-new-session-recall.png](A23/claude-new-session-recall.png) + [同库核验](A23/actual-workspace-probe.json) | C | 已有真实截图/HTTP+Git数据；A23通过，不冒充全程视频 |
| S09 Claude Code 接入 | [claude-code-contract-check.mp4](A16/claude-code-contract-check.mp4) + [录制元数据](A16/recording.json) | C | 已有约15秒真实窗口执行片段，无音频；不是干净克隆到结束的连续录像 |
| S09 Devin 接入 | [devin-execution-excerpt.mp4](A16/devin-execution-excerpt.mp4) + [元数据](A16/devin-recording.json)；[devin-http-realtime.mp4](A16/devin/devin-http-realtime.mp4) | C / Devin | 已有约14.4秒网页片段及55.6秒 HTTP 验证原速片段；只按该范围剪入 |
| S10 架构和范围 | `recordings/RR-10-architecture.mp4`；[当前 README](../../README.md) | C | 文稿已有，视频待录；plan 原图的 ACME 标历史已砍；计划能力要注明 |
| 通用化补充 | [sample-intent.jpg](console/sample-intent.jpg)、[sample-320.jpg](console/sample-320.jpg) | C | 本轮实际浏览器截图，Sample；本次条件与卡默认值分开 |
| 最终成片 | `recordings/agent-cookie-demo-reviewed.mp4` + `recordings/agent-cookie-demo-reviewed-metadata.json` | C | 计划3–5分钟，依赖已核验主线原片；尚未导出或宣布完成 |

## 入库信息与判定

每组 `*-metadata.json` 记录：`recordedAtUtc`、录制者/归属线、代码 SHA、组件版本、原片路径与 SHA-256、真实时长、数据模式、脱敏后的 intent/quote/session/evidence 关联、引用的回执/活动文件、检查结果与未解决限制。以上是**素材清单字段**，不是新增工作台 API 契约。收片后填实际值，不预填成功。

购物性质：商家≤2，价格不超这条输入的预算；预算单位一致；尺码未知或不匹配保留说明。地址放行必须对应已 accept 商家，另一家不获放行；Sample 地址不发给 live 商家。没有地址回执、只有handoff链接、售罄或失败都记录实际结果，不补造订单。

学习性质：保留从偏好输入到自然调度的原始时长；可在成片切成“约五分钟后”，原片不重排。同一对话重复仍是一源，模型链对应真实 evidence。候选不是已应用偏好；排序对照需同候选集合与同显式预算等条件，记录实际排序和解释。没有正向手机证据不能只凭模型6/6勾 C20。

所有入库素材由归属线先检查密钥、电话号码、完整地址、能力链接 token；对话只展示用户明确用于演示的短句，日志不加入完整聊天或模型请求体。保留字段名、时间、结果和关联所需的脱敏 ID。原片比精剪片优先交付。

## 当前缺口与切换条件

- **B**：三条新需求各自连续 iMessage 原片、Desktop 同店视频、干净手机学习和同候选集排序对照；已有日志/JPG继续保留，但不改称视频。
- **A**：对应同次搜索/checkout/撤销拒绝终端片；若网络无法实时搜索，保留失败，并给出来源明确的独立 Recorded run。needs 需先补 owner 投影，缺失即按分镜跳过。
- **C**：收到 A/B 合格原片后录对应真实控制台片、登记 hashes、剪辑；当前六张新 Sample 图可用于界面解释，不能解除真实链路缺口。

旧 [recorded-needs](recorded-needs/README.md) 三条 walking/hiking/running 是 catalog-only 历史；本轮 R2/R3 是新的外套/背包，不继承旧查询成功状态。用户已有 `docs/media/` 未读取、改写、入库或核验，不算本清单的可用原片。没有主线合格原片时，T9-4 清单可完成，最终视频交付仍待办。
