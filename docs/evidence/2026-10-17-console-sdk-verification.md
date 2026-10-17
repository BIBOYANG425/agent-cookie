# B 线控制台 SDK 交付与联调

2026-10-17，基于 `lane-b fd1b8d4`，合入 C `77b797d`（其中已包含 main `798e0de`、D B22 修复）。本轮只交付 lane-b，不把 B 合入 main。

## 完成内容

- 新增 `getGrants`、`revokeGrant`、`revokeContribution`、`demoReset`；方法名与 C 服务端桥接表一致。返回 A 已公布的 HTTP 载荷，并附 SDK 的 Sample 布尔值。正式签名、返回类型与接法见 `packages/sdk/README.md`。
- 所有 SDK 方法支持最后一个可选 `{ signal }` 参数；保留请求超时，不自动重试。预先取消不发请求；请求中途取消返回脱敏 AbortError。取消写请求不代表后台已撤回，调用方仍需读回状态。
- 撤销和 reset 只有明确调用才执行，未添加到个人 MCP 工具；角色、资源所有权和 demo gate 仍由后台核对。
- C 控制台实际八个路由通过真实 SDK → A Hono/SQLite 的隔离联调；写操作只在测试自己的内存数据库中执行。grant 撤销后 status=revoked，已知 seed contribution 撤销后字段消失；个人 key reset 得403，owner reset 恢复种子状态。
- 新版控制台已重启在5173，使用服务端 Sample owner 配置以及现有 `AGENT_COOKIE_SDK_ROOT` 接入本轮构建产物。八个方法均存在，不触发缺失方法的 HTTP fallback。浏览器确认 `Sample 工作台 · 已连接`，页面无需输入钥匙，卡片与实际数据库 grants 可读。

截图：`2026-10-17-console-sdk-connected.jpg`，原始浏览器截图。当前4310数据库未执行撤销或重置，原 iMessage/Desktop 服务保留运行。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| SDK | 53 passed，typecheck/build通过；含八路由真实桥接测试 |
| C console | 17 passed，typecheck/build通过 |
| Photon | 38 passed |
| MCP | 7 passed，含构建产物 stdio 回归 |
| CLI | 5 passed |
| SDK普通Node加载 | 成功；八个方法存在 |
| 本机控制台页面 | Sample连接成功，服务端持钥，无浏览器钥匙输入 |

普通 Node 加载检查发现 contract 当前导出 TypeScript 源码，不适合作为构建 SDK 的运行时依赖；SDK 保持仅导入契约类型，避免破坏 Desktop/CLI 的普通 Node 入口。之后重跑SDK全套检查并确认实际 Vite 服务成功加载构建产物。

## 尚未完成的团队事项

本轮核查的 main 为798e0de，A lane-a仍bd9d6e3；运行后台的三个默认 adapters 仍为桩。D B22的新尺码匹配/两家录制修复已同步进本地源码，但本轮没有切换运行手机线路或重验真实UCP下单。依照交接安排，手机保留带Sample标记的桩报价，等A完成真实适配器与地址seed接线后再复验。

C08与Desktop新后台截图在上一批fd1b8d4已完成，对应B24/B25；无需重复补。A14真实逐条来源撤销仍缺贡献记录/ID载荷；此处SDK方法就绪不代表UI已获得来源ID。C可按现有服务端桥接直接接SDK；在团队合并时由目录owner补正式依赖链接和清理缺失方法fallback。B继续等待A接线与P0验证后再合main。
