# PR20 与模型连通性复核

2026-10-17（America/Los_Angeles）。PR：[B 线通用需求与可选对话学习 #20](https://github.com/BIBOYANG425/agent-cookie/pull/20)。创建时 head f4cb2e5、base main32490f1，OPEN、非draft、MERGEABLE；未自行合并或启用auto-merge。MERGEABLE只表示无Git冲突。

## 模型：人的最新选择仍为OpenRouter

本轮先按指示检查Anthropic本地配置，仅报告是否存在，未输出凭据；当前环境、项目配置及已知blueprint clone的root/retail环境文件未找到可用key。随后用户明确回复“还是open router吧”，因此不再等待Anthropic路径。

沿用本机已配置的OpenRouter key，重新构建learn后，仅运行一次 `packages/learn/scripts/check-openrouter.mjs`。仍为Haiku4.5的Bedrock US路由，ZDR/data_collection deny、无fallback均保留；不切账户、地域或模型。只提交一条合成颜色偏好，敏感句/群聊他人句在本地拦截。

实际输出（退出码1）：

```json
{
  "mode": "live-synthetic-input",
  "model": "anthropic/claude-haiku-4.5",
  "filtersPassed": true,
  "extractionPassed": false,
  "reason": "unavailable",
  "requests": 1,
  "httpStatuses": [403],
  "elapsedMs": 207,
  "extractedFields": []
}
```

未取得真实模型输出，未启动完整六场景真实模型验收；原六场景脚本和断言与0f26ddf完全相同。没有发真实对话、写实际卡、发短信、下单或付款。之前账号页已提示闭源模型访问限制；这次403说明当前请求仍不可用，不是新截图中workspace/key ready就能证明权限恢复。停止后续模型请求，等待访问状态实际变化，不周期重试403。

## PR 首轮CI

[CI run 39081937704](https://github.com/BIBOYANG425/agent-cookie/actions/runs/39081937704)，对应head f4cb2e5：

- `acceptance suite typecheck`：SUCCESS。
- `typecheck, test, build`：FAILURE，实际执行到 `pnpm typecheck`，尚未执行后续测试与控制台build。
- 根 `build:deps` 只构建SDK；MCP导入 `@agent-cookie/learn` 时出现TS2307（缺模块/声明），继发signal参数TS7006。learn自身typecheck已通过，但typecheck不生成dist。

这是已交A处理的根依赖构建缺口，有实际CI日志支持。请A优先将learn纳入build:deps再复跑CI。B没有通过关闭检查、改类型断言、提交dist或修改A负责的根脚本掩盖。已有本机生成dist条件下的79项SDK测试/相关typecheck仍为该条件下的结果，不能当作干净克隆CI通过。

B49的业务修复仍待A/C；人的裁决见B50。新模型连通性结果和CI依赖追加B51。
