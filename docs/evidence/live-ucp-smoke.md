# Live UCP smoke（A 线，2026-10-17）

**结论：未能完成。本环境的网络策略拒绝 Shopify 主机（代理 CONNECT 403），live 模式拿不到任何真实报价，所以“两家真实报价 → accept → handoff 链接”这一段没有真实结果。下面只记录实际发生的事，没有补造数据。**

## 做了什么

1. 工作台以 live 模式起在本机：`PORT=4399 AGENT_COOKIE_UCP=live AGENT_COOKIE_DEMO=1 OPT_OUT_INSTRUMENTATION=true tsx src/server.ts`（文件 SQLite + 临时 git 记忆库，提交 `5748502` 之上的工作区）。
2. 跑冒烟脚本：`AGENT_COOKIE_URL=http://127.0.0.1:4399 AGENT_COOKIE_KEY=<personal key> pnpm --filter @agent-cookie/workspace smoke:live --out …`（脚本：`apps/workspace/scripts/live-smoke.ts`）。脚本只打 HTTP，输出里不含钥匙和地址。
3. 原始输出：[live-ucp-smoke-2026-10-17.json](live-ucp-smoke-2026-10-17.json)，`result: "not run"`，`quotes: []`，退出码 2。

## 为什么没有报价

- 工作台活动日志：`intent.create ok` → `ucp.search failed UPSTREAM_ERROR` → 只介绍了 1 家（Sample 回调商家 `sample-acme`，其 Tier 0 投递也因 Sample 地址不可达失败，`attempts=3`）。
- 直接跑 D 线锁定的 CLI（`@shopify/ucp-cli` 0.9.1）：`ucp catalog search` 返回 `PROFILE_FETCH_FAILED: request to https://catalog.shopify.com/.well-known/ucp could not be completed`。
- `curl https://catalog.shopify.com`、`https://marathonsports.myshopify.com/` → `curl: (56) CONNECT tunnel failed, response 403`。不重试、不绕代理、不关 TLS 校验。

## Sample 地址不发给真实店家

- 冒烟里已确认卡上的地址是 Sample（`cardAddressIsSample: true`，`cardAddressSource: "sample"`）。因为没有真实报价，accept 那一步没跑到。
- 这条规则由单元测试覆盖（不打真实店家）：`apps/workspace/test/live-guard.test.ts`。`AGENT_COOKIE_UCP=live` + Sample 地址时，accept 在读地址之前 handoff：没有 `shipping_address` 回执，UCP 调用只到 `cart.create`、`checkout.create`，**没有 `checkout.update`（setDestination）、没有 `complete`**；回复里写明“卡上是 Sample 地址，没有发送”。
- 冒烟脚本在 Sample 地址时也会断言同两条（无地址回执、告知用户），等网络放开后真实跑一次即可。

## 放开后怎么复跑

在环境的网络设置里允许 `catalog.shopify.com` 和 `*.myshopify.com`（以及 D 线录制用到的其他 Shopify 主机），然后重复上面 1–2 步。通过标准：`result: "pass"`，两条 `source: "live"` 的报价来自两家不同店，accept 为 `handoff` 且 `continueUrl` 为 https，Sample 地址下无地址回执。
