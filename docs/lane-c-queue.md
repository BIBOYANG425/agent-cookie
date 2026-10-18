## 最高优先级 · C21 / A23（2026-10-17 人的要求）

- [x] C21 C侧 Agent Memory Repo 互操作：短 MEMORY.md/Index、开放 metadata、限定四路径 reset、真正 YAML 与契约漂移检查；修复 Git 锁失败回滚和精确目标脏检查。最终 rules70 / memory48 / workspace234通过（原4todo保留），三包typecheck通过；见下方A23实际证据。
- [x] A23（P1）：专用工作台种库、未修改stock skill在Claude Desktop Code保存/commit、全新会话读回、同库contribute/purpose receipt/限定reset全部通过；[真实证据](evidence/cognition-skill-interop.md)，Synthetic自动支撑单列。
- [x] B49 C侧：pref证据来源与writer分离并返回evidenceSources；普通字段仍按writer；批量evidence撤销一个commit；Photon接力/作者不一致拒绝回归；原版B脚本完成隔离复跑。
- [ ] B49 全链路出口仍待A：原版B六场景1/6，stated降级/跨会话去重/writer-count包装/原话SQLite/接力record.agentId五项未过，详见[报告](evidence/b49-c-alignment.md)；不改B断言或放宽C校验。
- [x] PR21 跟进（2026-10-17）：核对 A PR19 / B PR20 与 B52；已落 main 的 pref、证据、学习响应与 IntentRecord 改用正式契约，控制台缺证据 ID 不再按 writer 计数。B 后到 `d9aa3ce` 补根 learn 构建，已在隔离树接入；未改六场景业务代码或断言。最新精确基线与结果见[复跑记录](evidence/B49/final-report.md)，缺口继续追加 requests。
- 第6项 `skills/agent-cookie/SKILL.md` 属于B线，更新要求与 CLAUDE.md 过期reset说明一并追加requests，由对应负责人修改。

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

循环：C17 → C18 → C19 → C20；实现、针对性验证、记录证据后再核对 A/B。已对齐 main `32490f1` 的学习类型及 B `d9aa3ce` 的学习计划/SDK；B 相比 `0f26ddf` 新增文档和根 learn 构建，A `9937542` 尚无 B49 后台修复。已发布类型的导入 TODO 已清理；B49 `evidenceSources`、批量撤销与 HTTP/事务接口仍待 A/B，局部扩展继续标 `TODO(contract)`。下列组件完成不等于真实 C20 完成。

- [x] C17 晋升规则：默认 rules/parser 接受 A 的 pref 白名单与嵌套 evidence；按 intentId/conversationId 别名连通关系去重，personal stated 立即 medium，observed/inferred 两个独立来源晋升 medium；同对话重复不算第二源，衰减后掉卡。52 tests，main/A/B 契约类型验证通过；已修复 A 扩展 FIELDS 导致 pref 卡重复的问题。
- [x] C18 意图记忆：默认 openMemoryRepo 支持嵌套 evidence 和 A 的 flat IntentRecord；作者使用实际 personal agentId，保留旧 C wrapper；仅写结构化摘要和 ≤200 字证据，剔除 text/query/public/title/seller 自由文本。append/list/revoke/reopen、commit author、检索与原文排除共 29 个真实 Git tests；main 与 B 整合契约类型检查通过。
- [x] C19 学到的视图：正式 `{paused,learned}` 分组，逐 evidence 用真实 contributionId 撤销，来源/短摘句/时间及暂停、2 秒轮询。SDK getLearned/getLearning 与 setLearning({enabled:!paused}) 已接真实 4310；5173 控制台通过 B e24957c SDK 的 10 个读取/暂停/恢复请求均200，owner key仅在服务端。35 tests、typecheck/build通过；正式载荷 fixture 使用 pref.material/color，旧截图只作历史 Sample。缺 SDK 方法才走标注 fallback。
- [ ] C20 学习真实证据：已交 [learning.md](evidence/learning.md)、真实 HTTP/SDK/延时读取 JSON、两家 live 报价基线、19 项性质/配置日志保护检查。两句目标对话被接受202，五分钟静默后 learned仍为空；未验证模型或偏好排序，未有本轮界面录屏。用户已明确 OpenRouter 配置由B处理且尚未完成；A默认learner接线、stated保留、跨对话去重及允许字段的排序映射仍见 requests。接口连通不计C20完成。

本轮验证：main 契约副本全量 545 passed（另1 skipped、4 todo），根typecheck与console build通过；B e24957c整合副本 rules52 / memory29 / learn43 / SDK79 / workspace214通过，workspace另4 todo，相关类型检查通过。没有复制A的P0验收，也未改plan.md。
