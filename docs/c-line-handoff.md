# C 线交接 · 2026-10-17

分支：`lane-c`。本次只写 C 线目录；没有修改 `docs/plan.md`、根配置或其他线源码。原有未跟踪 `docs/media/agent-cookie-demo.mp4` 未改、未作为本次证据、未提交。

本地计划仍为 v0.2；本次只读核对远端 `origin/devin/1792265075-plan-v0.3`，提交 `f23abfbc26c743aef1e4d634132c0e9ddd01d4a5`，采用用户指定的 v0.3 验收集合。人需同步计划与 core 到本分支，见 [追加请求](requests.md)。

## 已完成的第一阶段材料

- `fixtures/`：1 个 Sample 用户、2 个 personal agent 与 1 个 ACME shoe 注册项、3 条 stated 贡献（zh / 简短 / 42）、独立 Sample 地址。Agent/Contribution 通过对 `lane-a@1537c83` 原始 core 类型的临时 TypeScript 检查；没有复制类型到 C 线当新契约。
- [UCP 实录](../fixtures/ucp/README.md)：真实 ≤ $120 搜索、两家 discover、一次 cart create；源响应、输入、schema、哈希与脱敏说明齐全。US11 / US9 不证明 EU42 可售；未录到 A18 的失败路径。
- [验收骨架](../tests/acceptance/README.md)：22 个 todo；P0 15 项、P1 7 项；A10/A17 指向真实客户端证据采集说明。
- [Sample 控制台](../apps/console/README.md)：Vite + React 脚手架，显示三个来源记录。它尚未连接假/真工作台，不算 T6 或 H6 出口。
- [blueprint](../examples/blueprint/README.md)：源码固定在外部 `/tmp/agent-cookie-commerce-agents`；核对 memory 钩子位于 `examples/retail/api/main.py:40`。服务和 catalog 启动已核验，模型聊天因缺 Anthropic 凭据未完成；详见 [实测结果](../examples/blueprint/verification-2026-10-17.json)。
- [接入 skill](../skills/add-agent-cookie/SKILL.md)：已写定位和接入步骤及上游六方法协议差异。尚未在干净克隆生成/运行适配器，不称 A16 通过；`fixtures/expected/` 只记录参考实现缺的契约，不放不完整类。

## 已运行验证

使用临时 Node `v22.23.3`、pnpm `10.32.1`（未改系统 runtime）：

```sh
pnpm --dir apps/console build
pnpm --dir tests/acceptance test
node fixtures/ucp/verify.mjs
node --check fixtures/ucp/record.mjs
node --check fixtures/ucp/verify.mjs
```

控制台类型检查/构建通过，浏览器确认三个 Sample 字段和未连接提示可见。验收收集结果是 **22 todo、1 skipped、0 业务验收通过**。UCP 离线校验通过。历史 UCP 录制与 blueprint 启动使用机器当时的 Node 24.8.0，原始记录保留这个差异，没有改写成 Node 22。

## 仍需依赖与决策

A：冻结请求/响应、core 与 fake workspace，来源贡献 ID、grants/activity 形状，导入 seed 和 A22 稳定身份，clock/reset，UCP fixture loader 与真实 EU42 变体匹配。

B：SDK 方法、MCP/Photon 客户端运行入口及 A10/A17 真实证据。完整 T6、真 HTTP 验收、录屏在这些依赖到达后实施，不用前端假行为点亮测试。

用户追问 blueprint 是否值得使用后的建议：保留为 **P1 第三方接入样本**，不放在主线依赖。原版 ACME 无鞋且仅为 Sample catalog；Tier 0 需要上游 session/SSE 适配；Tier 2 需要删除与 purge generation 语义，不能只换一行。先完成 P0，再决定是否录短片。该建议已追加 requests；验收标准和计划仍由人修改。
