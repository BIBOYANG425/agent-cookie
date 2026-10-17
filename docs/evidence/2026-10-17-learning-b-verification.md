# B 对话旁听学习：交付与验证边界

2026-10-17 16:10 PDT。工作分支 lane-b；A基线0129f08，C基线6f81538，main843666b。最终复查远端未出现更新。未自行合main，未启用新的手机监听或修改Claude全局设置。

## 已交付

- 计划先提交35f6b38；通用品类入口9b27b88已先交付，不用旧购物截图证明新学习功能。
- L1–L7依次提交857d3b0、3763fff、3ff678a、b045c1c、4832be8、6e60977、aaffa63。A/C基线分别合进B的71fb36d与b1f9fde；本文件所在交付提交将临时学习提案改为A正式接口。
- `packages/learn`：受信机主边界、敏感/引用过滤、白名单、Jev可选类型判定、Haiku结构化抽取、zod值/证据校验、200字限制、超时与explicit-only降级。`createWorkspaceLearner`实现A的LearnApi，保留stated/observed/inferred，A负责接入。
- SDK：observe/getLearning/getLearned/setLearning；正式Observation/paused/LearnedResponse，PUT设置；个人权限继续由工作台验证。无后台幂等或原子forget契约时不自创字段。
- Photon：Spectrum Cloud app.messages归一化、仅机主DM、有界内存非阻塞队列、暂停/恢复、按实际贡献ID撤销并回读、正常回复附带每日结论摘要。全部群聊不学，普通偏好不自动变成购物intent；现有手机运行状态保持不变。
- MCP：可选observe工具、固定宿主来源、个人SKILL；Claude Code UserPromptSubmit示例仅在README，不读取transcript或安装全局hook。
- Photon OTel：独立trace/log，仅阶段/状态/计数/耗时；未给模型或遥测授权写卡。
- OpenRouter可选Haiku入口：同一抽取/校验管道，固定路由规则，无降级到其他模型。OpenRouter的模型别名不冒充Anthropic dated snapshot。
- SDK/learn构建打包契约运行时常量，修复原生Node加载TS-only contract的错误；无需全局TS loader。B内部依赖workspace:*，仅根锁。

## 实际检查

| 检查 | 结果 | 覆盖边界 |
|---|---|---|
| learn测试 | 43通过 | 规则、假Jev/Haiku/OpenRouter响应、A LearnApi适配、真实本机OTLP出口 |
| Photon测试 | 69通过（原68+新增整链路1） | 采集/队列/控制/摘要/旧回复路径；新整链路为合成Spectrum事件→真实SDK→隔离A HTTP/SQLite队列→B解析器 |
| MCP测试 | 13通过 | observe、原生stdio、通用购物；购物测试中仍可见B46的memory.write失败 |
| fake后台测试 | 6通过 | Sample fixtures和权限/路由 |
| SDK测试 | 78通过、1失败 | 学习正式HTTP调用、控制台方法、购物回归；失败见下 |
| learn typecheck | 通过 | 完整learn源码与测试 |
| learn/SDK/MCP/Photon build | 全部通过 | B源码构建；不代表全仓跨线类型通过 |
| 原生Node22加载MCP和Spectrum入口 | 通过 | 只导入，不启动云连接或发送消息 |
| SDK完整typecheck | 失败 | C evidence:string 与 A ContributionEvidence对象不兼容，B45 |
| 根锁/配置/示例 | 通过 | 冻结根锁校验、B依赖声明、README JSON及hook的node --check；未执行hook |

总计209项通过、1项失败，不能写成“全绿”。失败是保留原断言的 `packages/sdk/test/workspace-c-integration.test.ts:52`：A写intent的author是个人agent ID，C只接受literal personal，实际抛SCOPE_DENIED且出现memory.write(intent)=failed。没有改作者字符串或删断言掩盖。跨线typecheck错误位于memory-repo/src/index.ts与rules/src/index.ts、merge.ts，详见B45/B46。

离线模型素材标记为synthetic-protocol-fixture，不是真实录制。群聊他人/敏感测试断言模型和观察请求为零；慢/失败的观察不阻断回复，暂停丢弃迟到ack。隔离学习集成使用A内存SQLite、测试memory/UCP与合成“无稳定偏好”结果，仅证明传递和解析器调用；**没有证明正向上卡、两来源晋升、真实模型质量或历史删除**。

OTel实际向本机HTTP接收器导出trace/log，并检查正文金丝雀、电话、邮箱、偏好值和字段key均未出现；没有配置或声称Sentry外部账号收到数据。SDK/learn build将contract常量打包到JS，不将根锁正常生成的version:link当manifest错误。

可重跑命令（Node22，仓库根）：

```sh
pnpm --filter @agent-cookie/learn --filter @agent-cookie/sdk --filter @agent-cookie/mcp --filter @agent-cookie/channel-photon build
pnpm --filter @agent-cookie/learn --filter @agent-cookie/mcp --filter @agent-cookie/channel-photon --filter @agent-cookie/workspace-fake test
pnpm --filter @agent-cookie/sdk test
pnpm --filter @agent-cookie/learn typecheck
pnpm --filter @agent-cookie/sdk typecheck
```

最后两个SDK命令当前预期暴露上面的A/C失败；不要删除失败测试。新克隆须先构建learn和sdk，现有根build:deps还只构建sdk，已向A请求更新根启动依赖。

## 未启用与依赖

1. **A/B44**：原始Observation落SQLite、intent text/query落Git、stated降级、同agent跨conversation去重、缺持久代际和原子forget/证据历史清理。B的“忘掉”只能暂停后撤销当前贡献并回读；文案明确不能确认完全删除，保持暂停。
2. **C/A/B45–46**：嵌套evidence及作者身份不一致；C控制台按B43的实际paused/learned投影接，不沿用enabled/entries提案。
3. **A接线**：工作台loadLearn目前仍是空桩；需A添加learn依赖并注入createWorkspaceLearner、模型入口与关闭telemetry的生命周期。
4. **真实环境**：未调用真实Haiku/Jev/OpenRouter；未找到Spectrum Cloud凭据和学习OTLP配置。OpenRouter key可替代Anthropic直连key；Jev可暂缺，不能替代Spectrum凭据。真实调用前只收本地环境文件路径，不在聊天粘贴密钥。
5. **真实演示**：当前4310和旧Photon Socket.IO保持运行状态，未重置DB/cursor/outbox、未重发手机测试、未付款。旧Desktop与手机通过只算旧购物流程证据。独立的同店last_order真实商家开场仍按B38未通过。

L8离线B交付完成；L9真实A/C闭环与外部模型/Sentry验收继续等待依赖。Spectrum/OTel对TypeScript声明5/6 peer range而仓库为7.0.2，存在peer warning；B构建通过，真实云兼容仍未验证。
