/** V0.1 登记可 npm 安装的底座（D-bb01：添加=登记名单，不是任意包）。claude-code 不提供安装。 */
import type { BaseId } from '../adapters/contract'

export const REGISTERED_NPM: Partial<Record<BaseId, string>> = {
  codebuddy: '@tencent-ai/codebuddy-code',
  qoder: '@qoder-ai/qodercli',
}

/** npm install -g 同步等待上限（网络拉包，远长于 --version / --list-models） */
export const NPM_INSTALL_TIMEOUT_MS = 5 * 60_000
