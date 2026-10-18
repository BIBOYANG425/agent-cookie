# B 线：对话旁听学习实施计划

2026-10-17，人的要求授权 `packages/learn` 及本计划。仅推 `lane-b`，不自行合 main。A 负责契约/队列/接线，C 负责晋升/记忆/控制台。

## 基线和验收原则

当前 B 已接 A b824139 的 text 搜索契约，通用购物改动正在验证；须保留并完成，不能被新任务覆盖。当前 Photon 实际是 `@photon-ai/api` + Socket.IO，并未使用 Spectrum。新采集点按人要求接 `spectrum-ts` 的 `app.messages`；禁止 `@spectrum-ts/imessage-local`，不读取本机所有聊天，新旧回复监听互斥。

只学受信机主本人对个人 agent 的话；第一版保守丢弃全部群聊，也丢弃商家、助手、引用和转述。敏感话题（健康、宗教、财务、关系、行踪）整条不学。模型仅分类/抽取，不决定身份、权限、白名单或晋升。jar 只存结论、来源元数据和 ≤200 Unicode 字符的证据短摘句，不存对话原文。原文只在短期内存和模型请求中出现；不落盘、不入 outbox/日志/trace/错误。明确稳定陈述交 A/C 直接上卡；顺口陈述和推断交候选，不同对话的两来源晋升由 C 完成。

## 可勾选任务（每项验证、提交、勾选后继续）

- [x] L0：完成并保存已有通用购物 SDK/MCP/Photon 修改和隔离测试，区分旧实机证据。
- [x] L1：packages/learn 的局部类型、白名单注入、机主/敏感内容规则、zod 值和证据校验。
- [x] L2：规则 → 可选 Jev 类型判定 → 指定 Haiku 结构化抽取；无 Jev 降级、超时、取消、离线回放。
- [x] L3：SDK observe/getLearning/setLearning 和明确配置的 HTTP 桩测试；不把未冻结提案当生产接口。
- [x] L4：Spectrum app.messages → adapter.toEvent → 非阻塞有界内存队列；仅机主直聊，去重/超时/失败不影响回复。
- [x] L5：Photon 暂停/恢复/忘记控制及每日结论摘要；先阻断在途任务，后台确认才报告删除成功。
- [x] L6：MCP observe、个人 SKILL、Claude Code UserPromptSubmit README 示例；不改全局配置、不读 transcript。
- [x] L7：@photon-ai/otel 只记管道阶段/状态/计数/耗时，离线 exporter 验证无正文和私密值。
- [x] L8：隔离采集 → SDK → A队列 → B解析器链路（模型/记忆为桩）及敏感/群聊/撤销竞态/每日摘要回归，保存证据并更新 A/C 请求；交付提交推 lane-b。
- [ ] L9：A/C 接口到位后联调；本机真实模型/Sentry 凭据到位后才做真实验收，不能用桩冒充。

## B 的局部函数接口

```ts
type LearningTurn = {
  text: string; messageId: string; conversationId: string; occurredAt: string;
  source: 'photon' | 'mcp' | 'claude-code';
  speaker: 'owner' | 'other' | 'assistant' | 'merchant'; isGroup: boolean;
};
type PreferencePolicy = Record<string, { description: string; maxLength?: number }>;
type ExtractedPreference = {
  key: string; value: string; evidence: string; // 原话短摘句，最多200字符
  basis: 'stated' | 'observed' | 'inferred';
};
createLearner({ policy, classify?, extract, mode?, timeoutMs?, telemetry? }): {
  learn(turn: LearningTurn, options?: { signal?: AbortSignal }):
    Promise<{ preferences: ExtractedPreference[]; reason: string }>
};
// mode = 'all' | 'explicit-only'
// classify 返回 { stable: boolean; sensitive: boolean; keys: string[] }
// extract 返回 unknown，必须经 zod、policy 和 evidence 检查
```

policy 由 A 注入，空白名单零输出；不凭 `pref.*` 前缀放行。离线暂用 **Sample 提案** pref.color/material/fit/brand/response_style，不代表 A 已冻结。临时预算、健康饮食、宗教、关系、行踪等不在策略中。稳定尺码是否学由 A 决定。

## A/C 实际接口（A 0129f08，取代初始 B 提案）

```ts
// 来自 @agent-cookie/contract；SDK 观察调用不发未约定的幂等 header。
observe(input: Observation, options?: RequestOptions): Promise<{queued:boolean;paused?:true}>;
// Observation = {channel, conversationId, turns:[{role:'user'|'agent'|'other',text,at}]}
getLearning(options?: RequestOptions): Promise<{paused:boolean}>;
getLearned(options?: RequestOptions): Promise<LearnedResponse>;
setLearning(input: {enabled:boolean}, options?: RequestOptions): Promise<{paused:boolean}>;
// wire = PUT /personal/learning {paused:!enabled}
createWorkspaceLearner(options): LearnApi;
// extract(intent) / extractFromConversation(turns,{conversationId,channel})
```

A 的白名单有10个pref字段；B使用正式白名单的安全子集，不学price_band和recipient，避免财务/关系推断。转交真实stated/observed/inferred及≤200字snippet，B不写卡。

当前真实闭环仍受B44/B49阻塞：A原文队列落SQLite、stated降级、同agent不同conversation被去重、缺原子forget。A e381b15已加入持久epoch，隔离验证确认暂停后恢复会丢弃迟到结果；这部分旧阻塞解除，但不能据此声称历史删除完成。C 688754d 已对齐嵌套evidence，且intent投影不再把text/query/public持久化Git。原B46同agent路径保持通过；新A把IntentRecord.agentId保留为原发起者后，另一同机主agent接受报价的历史写入再次出现SCOPE_DENIED，见B49。A的卡合并包装又把不同conversation证据计数与writer agent数量混用。SDK观察默认关闭（learning:true显式开启）；MCP/Spectrum需workspace-v1开关，只在修复后的兼容后台启用。忘记暂按实际contributionId撤销、回读并保持暂停，明确不能确认历史证据彻底删除。

SDK与A真实HTTP状态/观察投递/解析调用已可隔离验证，模型使用合成响应；不把它当两来源晋升或实机学习成功。默认adapters.loadLearn仍是A空桩，A需自行import本包。

## 采集、控制和摘要

接口：`observeSpectrumMessages(app.messages, adapter, sink)`；`adapter.toEvent(message)` 仅归一化本应用收到的 inbound human text。配置机主 handle 在本机核对，电话/邮箱不放入观察载荷；持久 message/conversation 标识用 HMAC 哈希。群聊第一版全部拒绝。

`sink.enqueue(event): boolean` 不抛错到回复路径；并发1、队列最多32、内存排队TTL30秒、模型总时限10秒。满/超时就丢弃并记无内容计数；重启接受少学，不把原文做持久队列。保留原 Photon cursor/outbox。

“暂停学习”先停收/abort，再请求A；后台失败只说本机暂停、后台待确认。“忘掉 X”只确定性映射已学白名单 key，不明确就澄清；先中止旧任务，当前正式后台没有forgottenKeys/generation；按真实贡献ID撤销后只确认当前卡/候选撤销，不确认历史删除。“恢复学习”须明确命令且后台确认。日常陈述不能一概当购物请求。

每日摘要用后台当前有效结论模板生成，每个本地日最多一次，附在机主当天下一条正常交互回复中；不新建主动发短信的定时器。不再提撤销值，不调额外模型。

## 离线测试

无真实密钥时录制协议形状的 Jev/Haiku fixture 标 `synthetic-protocol-fixture`；不是模型实录。真录制另标时间/模型，只存去敏感结论和≤200字证据，不留原对话。测试至少包括：

1. “我一直更喜欢黑色衣服。”输出 stated 结论，交A/C；B不自行上卡。
2. “这件棉质的摸起来更舒服。”输出候选；同对话重试不晋升、不同对话两来源由C桩确认，不冒充真rules。
3. “我有哮喘，最近药费很贵；我喜欢蓝色。”整条零输出，Jev/Haiku零调用，trace无正文。
4. 群聊里别人说“我喜欢红色”：零输出/零模型调用；商家、助手、转述同样拒绝。
5. 临时需求、否定/条件句、提示注入、白名单外 key、超长/非原话证据、模型敏感值输出均丢弃。
6. Jev缺失→规则+Haiku；Jev明确拒绝→不调Haiku；超时/错误JSON/取消→安全空输出。
7. 队列满、挂起、异常不影响回复；暂停/忘记后旧任务迟到不再上报；保留消息去重。
8. trace/log金丝雀含邮箱/电话/原文/证据/key，导出内容均不得出现；不只依靠自动脱敏。
9. SDK权限拒绝、取消、精确路由；MCP仅本人原话；每日摘要一次且不复活撤销结论。

## 成本、延迟和H14砍法

固定模型 `claude-haiku-4-5-20251001`。官方输入 $1/百万 token、输出 $5/百万 token；按每次800–2000输入（含schema/prompt）、150–200输出估计 **$0.00155–0.003/次**。每天100条、10%进入模型则每月300次，Haiku约 **$0.47–0.90/人/月**。命中率是假设；Jev单价未核实，不宣称免费。调用预算/token限额/超时可配置。

本地过滤目标<5ms；Jev预算1.5秒、Haiku预算8秒，总上限10秒。这是时限/估计，不是实测性能。回复不等学习，拥塞可丢弃观察；摘要复用已存结论，无额外推理费。

H14不稳启用 `explicit-only`：只保留规则识别本人稳定陈述且Haiku验证为stated的白名单值；跳过Jev和候选推断。敏感过滤、证据上限、暂停/忘记不能砍。模型不可用则不持久学习，两来源未接好则候选不上卡。

只有真实密钥、需改别人目录、同一测试连续三次修不好才停；独立离线项继续。每项完成记录测试和提交，不把旧购物图当学习验收。

## 官方参考（已查，2026-10-17）

- [Spectrum](https://github.com/photon-hq/spectrum-ts)；[adapter/non-blocking模式](https://github.com/photon-hq/observability-boilerplate)。仅取模式，不复制其保存消息正文的数据库。
- [Photon OTel](https://github.com/photon-hq/otel)：独立runtime，只记固定元数据，关闭HTTP body/fetch自动记录。
- [Jev API](https://api.typesafe.ai/redoc)：typed questions/answers，真实账号验证前用可注入桩。
- [Haiku 4.5定价](https://platform.claude.com/docs/en/models/haiku-4-5/overview)；[结构化输出](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)。
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)：只示例UserPromptSubmit当前prompt，不读取transcript，不改全局配置。

L1 验证：26 项离线边界测试、typecheck/build 通过。模型为注入桩，未调用真实服务。

L2 验证：33 项 learn 测试、typecheck/build 通过；Jev/Haiku fixture 明确为合成协议回放。固定模型、拒绝/降级、敏感与群聊零调用已覆盖。

L3 验证：SDK 学习提案接口5项测试及typecheck/build通过；未配显式binding时零网络请求，身份字段不透传，取消/拒绝保留。A契约未到，实际后台仍禁用。

L4 验证：5项采集/队列测试与Photon typecheck通过；Spectrum app.messages循环适配器已实现，真实云入口及控制在L5接线。整条DM的conversationId稳定，不凭时间切片伪造第二来源；A/C需确认可信对话边界。

L5 验证：12项采集/控制测试及Photon typecheck/build通过；Spectrum云入口编译通过但未启用。日常偏好不发购物intent；删除确认要求generation前进；摘要只在正常回复中附加，无主动定时短信。

L6 验证：MCP协议11项测试和typecheck/build通过。observe不接受模型身份/来源参数；hooks仅README例子，未写任何全局配置或读取transcript。

L7 验证：learn共35项测试及typecheck/build通过；实际Photon OTel向本机OTLP接收器导出了trace/log，金丝雀正文/电话/邮箱/偏好值/字段key均未出现。Sentry外部接收尚未配置。

接口变更说明：L3/L5早期验证记录针对当时明确标记的B提案；以上A正式接口已取代它，删除完成与迟到写防护仍归L9阻塞，不能沿用旧桩成功声明。

L8 验证（16:10 PDT）：learn43、Photon69、MCP13、fake6、SDK78通过；SDK另1项真实C记忆写回归失败（SCOPE_DENIED，B46）。SDK跨线typecheck被C evidence类型差异阻断（B45）；4个主要B包build和原生Node MCP/Photon入口加载通过，learn完整typecheck通过。隔离A队列已实际调用B解析器，不等同C两来源晋升或A原文存储合规。详见 docs/evidence/2026-10-17-learning-b-verification.md。

人的追问 OpenRouter：已增加 `createHaikuExtractor({provider:'openrouter',apiKey})` 可选入口，规则/zod/权限边界不变。OpenRouter使用 `anthropic/claude-haiku-4.5` 别名（不能声称是精确dated snapshot）。首次本地鉴权200；原Anthropic直连与ZDR不兼容返回404，已按官方ZDR端点表改为同模型的 `amazon-bedrock/us`，保留结构化输出、拒绝收集与ZDR、无fallback。修正后合成输入请求403，未取得有效模型输出，已停止真实重试。参考 packages/learn/README.md。

L9 部分进展（16:43 PDT）：接入C688754d至lane-b的e9112cf；SDK79/rules52/memory29/console35共195项通过，learn43项通过；SDK/learn/MCP/Photon/rules/memory/console七包类型检查通过。新增控制台→真实SDK→隔离A的学习状态/记录/暂停/恢复覆盖，十一种SDK方法均实际调用，修改后该聚焦测试及SDK/learn类型检查再通过。learn构建通过。OpenRouter key已本地保存且鉴权有效，提取仍被上游403阻止。A隐私/晋升/删除接线、真实Spectrum及外部Sentry未验收；L9保持未勾选。详见 docs/evidence/2026-10-17-learning-c-alignment.md。

L9 新进展（A e381b15 / C688754d）：A新代码经0fbf12d合入B，SDK79项和SDK/learn/MCP/Photon/workspace五包类型检查通过。新增可复跑的六场景验收探针，使用真实A SQLite/C rules与Git、注入合成抽取器：暂停恢复迟到结果1项通过，明确陈述上卡、两对话短间隔/31天间隔晋升、原话不落盘、跨个人agent接受后历史写入5项未满足人的要求。探针失败会返回退出码1，不纳入“全部通过”的单测统计。结果与定位见 docs/evidence/2026-10-17-learning-a-alignment.md / .json 和B49。人已选择先完成本地联调、模型稍后处理；保持无真实模型调用、不热接手机采集。Jev仅完成备选评估，尚未切换或真实调用。

L9 后续裁决（人已明确，优先于A29/A31旧说明）：stated直接上卡；两个独立conversationId/intentId可晋升，取消A的30天全局去重；原话有界内存、forget一次事务；author为当前操作执行agent、原intent在evidence.intentId，C一致性检查和权限不放宽。A在P0后实现并接loadLearn/build:deps。B保留六场景全部断言，待契约实现后复跑。人已授权改用Anthropic直连跑真实模型验收，OpenRouter暂停重试；本机尚缺队友使用的Anthropic配置路径，已询问，不打印或复制聊天密钥。PR交付先行，最新main32490f1已同步到lane-b；不自行合main。详见B50。
