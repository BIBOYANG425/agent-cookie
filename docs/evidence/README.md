# 验收证据

**状态：11 项规范 HTTP 测试通过，11 项规范仍 todo；尚无完整 demo 或真实客户端录屏通过结论。** 实际命令、A 工作台桩适配器边界和机器结果见 [C14 HTTP 证据](C14-http-acceptance.md)。另有一项 reset 支撑检查通过，但不替代完整 A12。[scaffold-verification.md](scaffold-verification.md) 保留先前 22 todo 阶段的历史记录。

本次用户已同意的演示路线为 **两个独立的 Anthropic ShoppingAgent Sample storefront + 一个 live UCP 商家**，两店共用接入实现、独立商家身份/session/notes；现场 coding agent 安装已推迟。操作、实际 HTTP/LLM 证据要求及 A03/A07/A08/A22 映射见 [双店 + UCP 取证说明](two-storefronts-and-ucp.md)。新真实集成尚未完成；它不改写原验收编号，也不让 A15/A16 自动通过。

控制台的 [Sample 身份卡](C09-fixture-card.md)、[真实 HTTP 展示/授权撤销/reset](C10-console.md)、[SDK 接线与 4310 检查](C10b-sdk.md)、[320px 与键盘检查](C16-console-polish.md) 已分别留证。A14 仍缺工作台逐条 contribution ID 载荷，不能以 Sample 来源撤销替代。包级规则和 Git 记忆库测试也不等于 HTTP 全链路已接通。

| 项目 | 等级 | 证据说明 | 当前状态 |
| --- | --- | --- | --- |
| [A10 真实客户端（手动）](A10-real-client.md) | P0 | Claude Desktop 的 MCP 调用与工作台活动导出 | 未执行 |
| [A17 iMessage 主流程（手动）](A17-imessage.md) | P0 | 真实 iMessage 从一句话到付款链接的录屏 | 未执行 |
| [A15 零接入投递](A15-tier-zero.md) | P1 | 原版 ACME 首条回复、代码未改证明、投递回执；保留原模板 | 未执行；双店接入不替代 |
| [A16 skill 生成的接入](A16-skill-integration.md) | P1 | 干净克隆、skill 执行、变更范围与 HTTP 读写证据；保留原模板 | 未执行；现场安装推迟 |

执行者把真实文件保存到本目录并在对应记录里填相对路径、日期、提交、命令、结果与判定理由。保留失败和阻塞；标为 `Recorded run` 的材料只代表录制时发生过的结果。示例数据统一标 `Sample`。发布的录屏和日志去掉钥匙、passkey、支付 token、完整地址等敏感值，但保留能核对行为的时间、调用名称、状态和字段名。

P0 = A01–A12、A17、A18、A22；P1 = A13–A16、A19–A21。只有全部 P0 的业务断言与两项真实手动证据都满足，才可声明可演示。A15/A16 的记录是补充证据，不会自动替代 HTTP 验收测试。
