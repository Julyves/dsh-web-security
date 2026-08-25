/**
 * 认证/安全事件类型（审计、限速与设置 UI 共用）。
 *
 * 纯类型 + 判别联合：宿主侧审计将其序列化为 audit.jsonl，
 * client 侧设置界面消费摘要视图。
 */

/** 认证事件类别。 */
export type AuthEventKind =
  | 'login-success'
  | 'login-failure'
  | 'login-locked'
  | 'logout'
  | 'session-expired'
  | 'account-created'
  | 'account-removed'
  | 'password-changed'
  | 'passkey-registered'
  | 'passkey-removed'
  | 'settings-changed'
  | 'entry-started'
  | 'entry-stopped'

/** 一条审计记录（落盘形态；时间戳为 epoch 毫秒）。 */
export interface AuthEvent {
  readonly kind: AuthEventKind
  readonly at: number
  /** 触发者标识：登录类为用户名，其余为来源描述。 */
  readonly actor: string
  /** 来源 IP（登录类事件）。 */
  readonly ip?: string
  /** 附加细节（如失败原因码、变更字段名）。 */
  readonly detail?: string
}

/** 登录限速的锁定判定结果。 */
export type LoginGate =
  | { readonly state: 'allowed' }
  | { readonly state: 'locked'; readonly retryAfterMs: number }