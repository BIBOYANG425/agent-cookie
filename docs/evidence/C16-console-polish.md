# C16 · 控制台浏览器打磨

2026-10-17 实际浏览器检查，使用 [C10 控制台实现](C10-console.md)；Sample 操作均只影响本页内存。以下记录保留当时结果，不能替代后续 C10b SDK 接线和后台可达性检查。

| 检查 | 实际结果 |
| --- | --- |
| 320 × 740 viewport | `innerWidth=320`、body/document scrollWidth 均为 320，无横向溢出 |
| 触控尺寸 | 可见 button 的最小实测高度 44 px |
| 来源键盘操作 | 用 Enter 展开鞋码来源，能读 agent、依据、时间和记录 ID |
| 撤销焦点 | 撤销最后一条来源后 activeElement 为 `card-title` |
| 空状态 | 三条来源全撤后提示无字段及可重置；reset 恢复三条 |
| 授权 | A 撤销后显示已撤销且按钮禁用；B 保持倒计时 |
| 错误状态 | 上游返回非 JSON 时明确失败；不显示伪造成功或旧来源 ID |
| 浏览器日志 | Sample 检查时未捕获 error；后续代理故障和修复另记 C10 |

视觉检查：窄屏 header 换行、字段和值纵排、来源和长 ID 可折行；区域留白、标题层级和按钮位置在窄屏仍可辨。检查后撤销临时 viewport 设置，浏览器恢复默认尺寸。没有声称运行完整 a11y 合规审计或两小时计时评审。

截图为 320 px 宽的整页截屏，拍摄时 viewport 高 740 px；图片长于 viewport 是完整页面内容，并非横向溢出。

![320px Sample 控制台整页截屏](console/history/sample-320.jpg)

相关测试：C10 的 12 项 adapter/controller 测试、类型检查与生产构建通过。此界面证据不替代 A14 的真实来源记录撤销；A 的 contribution ID 载荷仍需补齐。

2026-10-17 C23：本页保留历史截图；新版通用字段/本次条件/回执见 [当前控制台证据](console/README.md)。
