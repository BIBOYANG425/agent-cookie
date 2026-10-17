# C 线交接 · 2026-10-17

分支：`lane-c`。本次只写 C 线目录；没有修改 `docs/plan.md`、根配置或其他线源码。原有未跟踪 `docs/media/agent-cookie-demo.mp4` 未改、未作为本次证据、未提交。

本地计划仍为 v0.2；已只读核对 v0.3 指定章节，采用用户指定的 v0.3 验收集合。后续 fetch 确认 `origin/main@d48e263` 已合入 v0.3 文档，但 A/B 分支尚无冻结契约、SDK 或 fake workspace。人需同步计划与 core 到本分支，见 [追加请求](requests.md)。

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

用户已确认新的优先方向：**一个真实 UCP 商家 + 两套独立 Sample shopping agent，共用一份接入实现**，两店沿用 blueprint 原有通用商品，后置现场 coding agent 安装环节。详见 [当前演示方向](two-storefront-demo.md)。原版无鞋、session/SSE、六方法 memory 等实地发现仍成立，必须解决；验收标准和计划仍由人修改。

## 双店准备进度

- [双实例启动器](../examples/blueprint/dual/USAGE.md) 已实际启动两个独立外部克隆，使用 Node 22.23.3：A 的 8000/3000、B 的 8001/3001。各 health、页面、catalog 为 200，自己的聊天 token 读 memory 为 200，交叉使用为 401。12 个配置隔离与 HTTP 探针测试通过，探针禁止代理和重定向。已正常停止服务、保留数据。原版页面仍是 ACME UI，最终演示需加入明确的 Sample A/B 标签。
- [共享 session/SSE transport](../examples/blueprint/INTEGRATION.md) 的 9 个离线测试通过，覆盖 token 不能跨店、200 错误流、断流、token 上限、工具拒绝与重定向。两边实际创建上游会话成功，但实际 chat 均为 `upstream_error`，详见 [真实探针结果](../examples/blueprint/transport-verification-2026-10-17.json)。没有真实 LLM 成功结论。
- [双店取证说明](evidence/two-storefronts-and-ucp.md) 已定义实际字段读取、独立 note、只撤 A、换 personal 回 B 与 live UCP cart 的证据。当前未连接工作台，也没有这些行为通过的记录；22 项验收继续 todo。

下一步由 A/B 交付冻结载荷、受信身份绑定和 SDK 后，接上游偏好读取与现有 note 工具；模型前检查授权，服务端串行到历史写回完成，禁用未接入的旧持久记忆路径。两店模型凭据需配置在各自后端环境文件中，不进入本仓库或聊天。
