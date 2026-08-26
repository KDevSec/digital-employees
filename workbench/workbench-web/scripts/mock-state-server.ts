/**
 * L5 看板线浏览器走查用 mock service（临时，不提交产物）：
 * 只提供 dev 代理所需最小面——/api/state（authenticated ACTIVE）+ /healthz。
 * 用法：bun scripts/mock-state-server.ts（监听 19990）
 *   VITE_PROXY_TARGET=http://127.0.0.1:19990 bun run --cwd workbench/workbench-web dev -- --port 19986
 */
const STATE = {
  installationId: 'mock-installation',
  status: 'ACTIVE',
  authenticated: true,
  user: { name: '走查', sub: 'walkthrough' },
  enrollmentId: 'mock',
  terminalId: 'mock-terminal',
}

Bun.serve({
  port: 19990,
  async fetch(req) {
    const url = new URL(req.url)
    if (url.pathname === '/api/state') {
      return Response.json(STATE)
    }
    if (url.pathname === '/healthz') {
      return Response.json({ app: 'workbench', status: 'ok', version: '0.0.0-mock' })
    }
    return Response.json({ error: { code: 'NOT_FOUND', message: url.pathname } }, { status: 404 })
  },
})
console.log('mock state server on http://127.0.0.1:19990')
