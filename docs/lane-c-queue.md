- [x] C01 fixtures 种子与 dev-keys 对齐 v0.3（Category 只有 personal|shoe） — ff01d0b
- [x] C02 fixtures/ucp 录好 catalog search、两家 discover、cart create，并记两个在库变体 ID — 8606f9e（本轮重新运行 verify.mjs 通过）
- [x] C03 tests/acceptance A01–A22 的 it.todo 空壳（A10、A17 指向 docs/evidence） — 8606f9e（22 todo；本轮收集与类型检查通过）
- [x] C04 packages/rules：deriveSessionId + 3 个测试 — dacbc1e
- [x] C05 packages/rules：mergeCard（全部规则，显式 now）+ 测试 — b13b108
- [x] C06 packages/rules：renderCard / renderContribution / parseContributions 往返无损 + 测试 — 59888f7
- [x] C07 packages/memory-repo：openMemoryRepo、appendContribution、writeNote/readNote/deleteNote（≤2KB）、appendReceipt + 测试 — ab57e2f（11 个真实 Git 用例、类型检查通过）
- [x] C08 packages/memory-repo：regenerateCard（调 rules 生成 CARD.md）、resetToSeed、每次写一个 commit（author=写入者，trailer Agent-Cookie-Sig）+ 测试 — a85471a（17 个真实 Git 用例、类型检查通过）
- [x] C09 apps/console 骨架：身份卡视图，对 fixtures 或假工作台渲染 — 947b760（浏览器验证与截图）
- [x] C10 apps/console：授权视图（剩余时间、撤销）、活动视图、重置按钮，2 秒轮询 — d58babb（12 测试、类型/构建检查、浏览器实连通过）
- [x] C10b 控制台 SDK 方法清单、服务端 owner key 与真实 4310 连接验证 — 811e5fc、043e8a9（17 测试、类型/构建检查；实际 SDK 读取及 HTTP 撤销/reset 验证通过）
- [ ] C11（P1）fixtures/expected/agent_cookie_memory_store.py 参考实现 — 1abcbfa（13 项离线协议测试通过） BLOCKED: 完整 Tier 2 HTTP 缺 note 删除/枚举/clear、持久 generation/条件写入及卡字段映射；已交可验证的六方法内存参考和 TODO(contract)。
- [x] C12 skills/add-agent-cookie/SKILL.md — 8a331bc（front matter/引用检查通过；A16真实接入及录屏仍待办）
- [x] C13 ACME Tier 0 注册项与 docs/evidence/A15 说明 — 2e544bc（配置已核对；A15真实模型证据仍待办）
- [ ] C14 手动证据收集（用户于 2026-10-17 调整范围）：A15 原版 retail :8000 + Tier 0 首条回复正确使用本次卡上适用 auto 字段；A16 干净克隆由 Claude Code、Devin 各跑一次并录屏；A10/A17 由 B 提供，C 维护索引。P0 自动项由 apps/workspace/test/acceptance 推进（用户确认 66/66），tests/acceptance 保留历史并维护性质断言，不复制 A 的整套。A15 已尝试并 BLOCKED；A16 Claude / Devin 实跑完成，有限 HTTP 接缝通过（34/34、29/29），完整 MemoryStore 仍 BLOCKED。
- [x] C15 README：agent 名、启动命令、环境变量表 — 6327cb1（本地链接/agent 名核对通过，已同步 main 798e0de 状态）
- [x] C16 控制台打磨（Paper 赛道）：间距、空状态、键盘可达、320 宽度 — d94557e（真实窄屏截图、44px 按钮与键盘/空状态证据；C10b 浏览器复核受工具策略限制）

- [x] T9 文稿（原 C17，2026-10-17 为学习功能腾出编号）：docs/README.md 定稿、Devpost 文案草稿、4:10 iMessage 主线分镜（3:10 失败删减版） — c04fe17。正式视频仍需 A17 原片与证据核验，不等于 T9 总出口完成。

- [ ] T9 通用演示（原 C18，2026-10-17 为学习功能腾出编号）：既有 HTTP 验收改为动态卡/本次预算与性质检查；控制台按契约字段通用渲染；分镜改为现场需求并备三条真实 catalog 支撑材料。7e14908 已交代码/文稿与三条真实 catalog 材料；三条完整 iMessage Recorded run 仍待 A/B/D 通用意图接线与 B 连续原片，不因 catalog 查询成功而勾完。

## 动态记忆 + 对话旁听学习（人的要求，2026-10-17）

循环：C17 → C18 → C19 → C20；每项实现、针对性验证、记录证据，再检查 A/B 接口是否已到并替换 `TODO(contract)`。B 线主导，最终以 `docs/lane-b-learning-plan.md` 和 A 的契约为准。本轮已读取 B 后续发布的计划 35f6b38；A b824139 暂无正式学习类型。下面勾选表示 C 的组件/桩已交付，不代表 A/B 真实链路通过；C20 真实出口单列保持未完成。

- [x] C17 晋升规则：证据按 intentId / conversationId 及两者别名连通关系去重；personal stated 立即 medium；inferred 单源候选、两个独立来源晋升 observed/medium；pref.* 同样衰减。显式 now、最新合格值、同值刷新、未来时间排除、格式往返与别名回归共 47 tests，类型检查通过；正式类型待 A 对齐。
- [x] C18 意图记忆：appendIntent({ intent, extracted, chosenQuote? }, meta) → intents/<YYYY-MM-DD>-<id>.md，searchIntents(q) 全文摘要；结构化白名单及 ≤200 字证据，不存对话原文。每写一次一个 personal commit；openLearningMemoryRepo 支持 pref 贡献与 CARD 重建。24 个真实 Git 测试与类型检查通过；本地扩展 TODO(contract)，不代表 A 已接线。
- [x] C19 学到的视图组件：GET /personal/learned、PUT /personal/learning、SDK getLearning/setLearning({enabled}) 接缝；候选/上卡、来源/证据/时间、已知贡献 ID 撤销、暂停与 2 秒轮询。32 tests、类型/构建检查和 Sample 浏览器操作通过，含既有 SDK 撤销方法类型兼容回归。B confirmed/未知 ID 保守展示并禁用逐条撤销；真实 4310 learned=404，正式 C19 联调待 A 契约，缺方法保留 TODO(sdk)/TODO(contract)。
- [ ] C20 学习真实证据：已交 [learning.md](evidence/learning.md)、4 张 Sample 界面图、9 个响应性质检查（另 1 HTTP 用例显式跳过）。真实“闲聊→帮我找双鞋”的 B learn、A 端点及报价排序截图仍待接线；不固定店名，不把候选凑成双源，不因 Sample 已跑就勾完。
