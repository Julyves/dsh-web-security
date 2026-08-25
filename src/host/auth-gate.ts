/**
 * 认证门中间件：cookie 解析 + 会话校验 + 路径可见性规则。
 *
 * 与框架无关的纯逻辑模块。路径规则（蓝图 D-M1-9）：
 * - /security/* → public（放行不认证——登录页/登录 API）
 * - 其余路径 → authenticated（需有效 cookie + 会话有效）
 */

import { parseSessionToken } from './session-store'

/** 认证检查结果。 */
export interface AuthCheckResult {
  /** 是否已认证。 */
  readonly authenticated: boolean
  /** 已认证时的用户名。 */
  readonly username?: string
}

/** 创建认证门。 */
export function createAuthGate(deps: {
  resolveSession: (token: string) => { username: string } | undefined
}): {
  /** 检查请求是否已认证。 */
  check(cookieHeader: string | undefined, path: string): AuthCheckResult
} {
  const PUBLIC_PREFIX = '/security/'

  function check(cookieHeader: string | undefined, path: string): AuthCheckResult {
    // 公开路径放行（但返回 authenticated 状态供登录页 UI 用）。
    if (path.startsWith(PUBLIC_PREFIX)) {
      const token = parseSessionToken(cookieHeader)
      if (token !== undefined) {
        const session = deps.resolveSession(token)
        if (session !== undefined) {
          return { authenticated: true, username: session.username }
        }
      }
      return { authenticated: false }
    }

    // 受保护路径：必须有有效 cookie + 会话。
    const token = parseSessionToken(cookieHeader)
    if (token === undefined) return { authenticated: false }
    const session = deps.resolveSession(token)
    if (session === undefined) return { authenticated: false }
    return { authenticated: true, username: session.username }
  }

  return { check }
}
