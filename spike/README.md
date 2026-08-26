# MCP server spike（Bun + @modelcontextprotocol/sdk + hono）

> 路线图 §6 头号技术风险前拉实证（原排 I1/L3 线内 spike ≤ 0.5 天，2026-08-25 提前消险）。
> 结论与设计影响见 [docs/research/MCP-server-Bun可行性Spike报告-2026-08-25.md](../docs/research/MCP-server-Bun可行性Spike报告-2026-08-25.md)。
> **非产品代码**——不实现任何引擎逻辑（工具面是 echo 级假账本），不触碰 workbench-service。

## 文件

| 文件 | 作用 |
|------|------|
| [src/tools.ts](src/tools.ts) | 共享工具面：`spike_echo` / `spike_advance` / `spike_record_gate`（贴 D-037 模式一语义，内存计数器假账本） |
| [src/stdio-server.ts](src/stdio-server.ts) | Q1a：stdio 形态（`McpServer` + `StdioServerTransport`，mcp.json 的 command 形态） |
| [src/http-server.ts](src/http-server.ts) | Q1b：HTTP streamable 形态（hono 挂 `/mcp` + `Bun.serve` + `@hono/mcp`，与 workbench-service 同构） |
| [src/smoke-client.ts](src/smoke-client.ts) | SDK client 自测：双形态 initialize → listTools → callTool，退出码 0=全绿 |

## 复跑

```bash
cd spike
bun install
bun src/smoke-client.ts   # 双形态自测（stdio + http 各 4 项 + 起活检查，10 项断言）

# 单独起 HTTP server（真机底座验证用；端口默认 29980，避开 19980/19981 及路线图 19982~19986）
bun src/http-server.ts
curl http://127.0.0.1:29980/healthz
```

底座接入配置（项目 `.mcp.json`，CB / qodercli 实测同格式通用）：

```json
{
  "mcpServers": {
    "spike-stdio": {
      "command": "bun",
      "args": ["<worktree>/spike/src/stdio-server.ts"]
    },
    "spike-http": { "type": "http", "url": "http://127.0.0.1:29980/mcp" }
  }
}
```

## 版本锚点（2026-08-25 实测）

- bun 1.3.9 · @modelcontextprotocol/sdk 1.30.0 · @hono/mcp 0.3.2 · hono ^4 · zod ^3
- 底座：codebuddy 2.138.0 · qodercli 1.1.29（Windows 11 Home China）
