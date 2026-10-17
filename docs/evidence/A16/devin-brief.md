# A16 · Devin 独立实跑交接

发送记录：用户明确授权后，已将下方任务说明发送至 [Devin A16 独立实跑](https://app.devin.ai/sessions/94dae4b1d11547c698d04be4119e41eb)。发送时标题含“待发送”；下方正文保留原文。

目的地：用户已登录的 app.devin.ai / BIBOYANG425 组织，新建独立 A16 会话。

请从 https://github.com/anthropics/commerce-agents 创建新的干净外部克隆，固定 fd4d59224ab96b43c6dc6888207c67b3bd5a24cf。执行前记录 clean git status 和精确 commit。不要在 Agent Cookie 仓库里复制第三方代码。

读取 BIBOYANG425/agent-cookie 的 main 8c1a869fe9fc67c7d7a80dd09714d0a4d21b6954 中 skills/add-agent-cookie/SKILL.md 及 references/commerce-agents.md；实际按该 skill 执行。packages/contract/src/types.ts、policy.ts、apis.ts、endpoints.ts 及工作台 HTTP 路由仅作只读契约依据。定位可信 session、JsonFileMemoryStore 的全部方法，自己生成 adapter 和必要 wiring/测试，保留原过滤、撤销和 generation 语义，不复制 fixtures/expected。

C11 明确为 P1 BLOCKED：商家 note 枚举、删除、clear、持久 generation/条件写入尚未冻结。不能自造端点、空操作删除/clear、授权失败后本地回退，不能把离线通过写成完整 Tier 2。若 skill 因该契约缺口停止，请交具体 blocker 与最小接入建议，保持真实失败。

A16 通过要求：生成实现实际经工作台 HTTP 读授权字段、写入并读回本商家 note。可在你的环境中启动上述提交的未修改工作台，使用独立临时数据目录与 Sample fixtures；不付款，不直读 SQLite/git 用户记忆库，不打印凭据。只修改外部 blueprint 克隆及独立证据目录，不改或推送 agent-cookie，不向上游提交 PR。

保存基线、命令、diff、测试与 HTTP 原始证据，录下真实执行屏幕（有录屏能力时）；不能生成模拟视频。交付会话链接和可下载文件路径，并分别报告真实成功与阻塞。Claude Desktop 另有独立运行，不能复用它的生成结果冒充 Devin 运行。
