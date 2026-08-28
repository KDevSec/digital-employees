import type { WorkbenchConfig } from './schema'

/**
 * 出站 TLS 校验策略（022，内网自签试点开关）：
 * Bun/Node 全局 fetch（含 jose createRemoteJWKSet 内部 fetch）在运行时读取
 * NODE_TLS_REJECT_UNAUTHORIZED：'0' = 跳过证书校验。实测运行中设置立即生效、
 * 删除后恢复校验（可逆）。默认（insecureTls=false）删除该变量 = 安全默认（校验）。
 */
export function applyTlsPolicy(cfg: WorkbenchConfig): void {
  if (cfg.platform.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  } else {
    delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
  }
}
