# B 线：对话旁听学习实施计划

2026-10-17，人的要求授权 `packages/learn` 及本计划。仅推 `lane-b`，不自行合 main。A 负责契约/队列/接线，C 负责晋升/记忆/控制台。

## 基线和验收原则

当前 B 已接 A b824139 的 text 搜索契约，通用购物改动正在验证；须保留并完成，不能被新任务覆盖。当前 Photon 实际是 `@photon-ai/api` + Socket.IO，并未使用 Spectrum。新采集点按人要求接 `spectrum-ts` 的 `app.messages`；禁止 `@spectrum-ts/imessage-local`，不读取本机所有聊天，新旧回复监听互斥。

只学受信机主本人对个人 agent 的话；第一版保守丢弃全部群聊，也丢弃商家、助手、引用和转述。敏感话题（健康、宗教、财务、关系、行踪）整条不学。模型仅分类/抽取，不决定身份、权限、白名单或晋升。jar 只存结论、来源元数据和 ≤200 Unicode 字符的证据短摘句，不存对话原文。原文只在短期内存和模型请求中出现；不落盘、不入 outbox/日志/trace/错误。明确稳定陈述交 A/C 直接上卡；顺口陈述和推断交候选，不同对话的两来源晋升由 C 完成。

## 可勾选任务（每项验证、提交、勾选后继续）

- [x] L0：完成并保存已有通用购物 SDK/MCP/Photon 修改和隔离测试，区分旧实机证据。
- [x] L1：packages/learn 的局部类型、白名单注入、机主/敏感内容规则、zod 值和证据校验。
- [ ] L2：规则 → 可选 Jev 类型判定 → 指定 Haiku 结构化抽取；无 Jev 降级、超时、取消、离线回放。
- [ ] L3：SDK observe/getLearning/setLearning 和明确配置的 HTTP 桩测试；不把未冻结提案当生产接口。
- [ ] L4：Spectrum app.messages → adapter.toEvent → 非阻塞有界内存队列；仅机主直聊，去重/超时/失败不影响回复。
- [ ] L5：Photon 暂停/恢复/忘记控制及每日结论摘要；先阻断在途任务，后台确认才报告删除成功。
- [ ] L6：MCP observe、个人 SKILL、Claude Code UserPromptSubmit README 示例；不改全局配置、不读 transcript。
- [ ] L7：@photon-ai/otel 只记管道阶段/状态/计数/耗时，离线 exporter 验证无正文和私密值。
- [ ] L8：隔离桩全链路及敏感/群聊/撤销竞态/每日摘要回归，保存证据、更新 A/C 请求并推 lane-b。
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

## A/C 接口：待冻结的提案，桩可先实现

唯一已由人指定的端点是 `POST /personal/observations`。SDK 其余路径用显式 binding，默认不启用未冻结端点；不探测备用路由。

```ts
observe(input: {
  source: 'photon' | 'mcp' | 'claude-code';
  messageId: string; conversationId: string; occurredAt: string;
  text: string; // A仅内存攒批，处理/过期即丢弃，不写jar/history
}, idempotencyKey: string, options?: RequestOptions):
  Promise<{ accepted: boolean; observationId?: string; reason?: string }>;
getLearning(options?: RequestOptions): Promise<{
  enabled: boolean; generation: number;
  learned: Array<{ id: string; key: string; value: string; evidence: string;
    basis: 'stated' | 'observed' | 'inferred';
    status: 'candidate' | 'confirmed'; updatedAt: string }>;
}>;
setLearning(input: { enabled?: boolean; forgetKeys?: string[] }, options?: RequestOptions):
  Promise<{ enabled: boolean; generation: number; forgottenKeys: string[] }>;
```

提议 GET/POST `/personal/learning`，等 A 确认。A 必须从凭据/受信采集映射身份，不信任模型自报 owner；Observation 要携带可去重的可信 conversation/message 来源。暂停清队列，删除按 key 撤销全部相关结论/候选/证据；持久 generation 防止迟到结果复活，返回确切 forgottenKeys。C 需要单条删除时由 A 冻结 observation ID 端点，B 再接。

C 按不同 conversation 的独立证据晋升，同一会话多句、重放和入口镜像不算两来源；撤销后重新合卡且不恢复旧值。history 只存非敏感结论及元数据，控制台能读候选/已确认/来源并撤销。B 不直接写 SQLite/记忆库，不越界改 rules。

## 采集、控制和摘要

接口：`observeSpectrumMessages(app.messages, adapter, sink)`；`adapter.toEvent(message)` 仅归一化本应用收到的 inbound human text。配置机主 handle 在本机核对，电话/邮箱不放入观察载荷；持久 message/conversation 标识用哈希。群聊第一版全部拒绝。

`sink.enqueue(event): boolean` 不抛错到回复路径；并发1、队列最多32、内存排队TTL30秒、模型总时限10秒。满/超时就丢弃并记无内容计数；重启接受少学，不把原文做持久队列。保留原 Photon cursor/outbox。

“暂停学习”先停收/abort，再请求A；后台失败只说本机暂停、后台待确认。“忘掉 X”只确定性映射已学白名单 key，不明确就澄清；先中止旧任务，后台返回 forgottenKeys 后确认删除。“恢复学习”须明确命令且后台确认。日常陈述不能一概当购物请求。

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
