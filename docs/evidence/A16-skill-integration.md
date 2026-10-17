# A16 skill 生成的接入 · P1

当前记录见 [A16/README.md](A16/README.md)。用户于 2026-10-17 恢复 Claude Code 与 Devin 两次独立实跑要求，原“现场安装推迟”说明已失效。Claude Desktop Code 模式正在干净克隆上执行；Devin 已在用户明确授权后启动[独立会话](https://app.devin.ai/sessions/94dae4b1d11547c698d04be4119e41eb)。尚未取得完整通过证据。

通过标准：在干净的 blueprint 克隆上应用 `skills/add-agent-cookie`，生成的 MemoryStore 读到握手字段并写回 note；其余代码仅限必要 wiring 与相关测试。C11 的 P1 契约阻塞不能用空操作或本地 fallback 掩盖。

## 执行与取证

1. 保存上游来源、精确提交和干净工作树状态；记录本项目提交及 coding agent / skill 版本。
2. 从启动 `/add-agent-cookie` 开始连续录屏，保留实际命令、输出和失败。不得预先把 `fixtures/expected/` 的参考答案复制进克隆并声称是现场生成。
3. 保存生成的 diff，核对只发生契约允许的 MemoryStore 接入和必要测试变化。任何超出计划范围的改动单列为偏差，不直接判通过。
4. 通过真实工作台 HTTP 路径记录握手字段读取、同一商家 note 写入与读取结果；不直接读数据库或 git 记忆库验证。
5. 对照 `fixtures/expected/` 只做验收，记录生成实现的测试输出和所有差异。保留原有写过滤，商家只能读写自己的 note。

## 当前执行记录

执行人与基线、克隆证明、原始命令、生成 diff、真实 HTTP 与录屏状态统一维护在 [A16/README.md](A16/README.md)，避免模板中的“未执行”覆盖已发生的实跑。当前仍未满足完整通过标准。
