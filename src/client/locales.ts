/**
 * 设置页词典（settings.security 命名空间）。
 *
 * zh 为主、en 为对照（grill-me Q6-A）。label thunk 让导航文案跟随
 * 宿主 locale 变更（宿主 resolveSlotLabel 约定）。
 */
export type SecurityLocaleKey =
  | 'page'
  | 'bannerTitle'
  | 'statusLoadFailed'
  | 'accountsTitle'
  | 'username'
  | 'password'
  | 'create'
  | 'loadFailed'
  | 'hasPasskey'
  | 'changePassword'
  | 'currentPassword'
  | 'newPassword'
  | 'submit'
  | 'passwordUpdated'
  | 'removeAccount'
  | 'confirmRemove'
  | 'passkeyTitle'
  | 'registerPasskey'
  | 'remove'
  | 'passkeyCancelled'
  | 'passkeyError'
  | 'webauthnUnavailable'
  | 'policyTitle'
  | 'auditTitle'
  | 'retry'
  | 'loadMore'
  | 'save'
  | 'downgradeConfirm'
  | 'fieldPasswordLogin'
  | 'fieldPasskeyLogin'
  | 'fieldAuditEnabled'
  | 'fieldSessionTtl'
  | 'fieldMaxAttempts'
  | 'fieldRateWindow'
  | 'selectedAccount'
  | 'noPasskeys'
  | 'pickAccountHint'
  | 'noAuditEvents'

export const zh: Record<SecurityLocaleKey, string> = {
  page: '安全',
  bannerTitle: '部署警告',
  statusLoadFailed: '状态加载失败',
  accountsTitle: '账号管理',
  username: '用户名',
  password: '密码',
  create: '创建账号',
  loadFailed: '加载失败',
  hasPasskey: '通行密钥',
  changePassword: '改密',
  currentPassword: '当前密码',
  newPassword: '新密码',
  submit: '提交',
  passwordUpdated: '已更新',
  removeAccount: '删除账号',
  confirmRemove: '确认删除该账号？其活跃会话将被撤销。',
  passkeyTitle: '通行密钥',
  registerPasskey: '注册通行密钥',
  remove: '移除',
  passkeyCancelled: '通行密钥操作已取消',
  passkeyError: '通行密钥操作失败',
  webauthnUnavailable: '此环境不支持通行密钥（需要 HTTPS 安全上下文）',
  policyTitle: '安全策略',
  auditTitle: '审计日志',
  retry: '重试',
  loadMore: '加载更多',
  save: '保存',
  downgradeConfirm: '本次变更会削弱安全姿态（关闭审计/放宽限速/延长会话/关闭登录方式），确认执行？',
  fieldPasswordLogin: '密码登录',
  fieldPasskeyLogin: '通行密钥登录',
  fieldAuditEnabled: '审计日志',
  fieldSessionTtl: '会话时长（分钟）',
  fieldMaxAttempts: '失败锁定阈值（次）',
  fieldRateWindow: '失败窗口（分钟）',
  selectedAccount: '已选账号',
  noPasskeys: '暂无通行密钥',
  pickAccountHint: '选择一个账号以查看或注册通行密钥',
  noAuditEvents: '暂无审计记录',
}

export const en: Record<SecurityLocaleKey, string> = {
  page: 'Security',
  bannerTitle: 'Deployment warnings',
  statusLoadFailed: 'Failed to load status',
  accountsTitle: 'Accounts',
  username: 'Username',
  password: 'Password',
  create: 'Create account',
  loadFailed: 'Load failed',
  hasPasskey: 'Passkey',
  changePassword: 'Change password',
  currentPassword: 'Current password',
  newPassword: 'New password',
  submit: 'Submit',
  passwordUpdated: 'Updated',
  removeAccount: 'Remove account',
  confirmRemove: 'Remove this account? Its active sessions will be revoked.',
  passkeyTitle: 'Passkeys',
  registerPasskey: 'Register passkey',
  remove: 'Remove',
  passkeyCancelled: 'Passkey operation cancelled',
  passkeyError: 'Passkey operation failed',
  webauthnUnavailable: 'Passkeys are unavailable in this context (HTTPS secure context required)',
  policyTitle: 'Security policy',
  auditTitle: 'Audit log',
  retry: 'Retry',
  loadMore: 'Load more',
  save: 'Save',
  downgradeConfirm: 'This change weakens the security posture (disabling audit / loosening rate limits / extending sessions / disabling a login method). Proceed?',
  fieldPasswordLogin: 'Password login',
  fieldPasskeyLogin: 'Passkey login',
  fieldAuditEnabled: 'Audit log',
  fieldSessionTtl: 'Session TTL (minutes)',
  fieldMaxAttempts: 'Failed-login lockout threshold',
  fieldRateWindow: 'Failure window (minutes)',
  selectedAccount: 'Selected account',
  noPasskeys: 'No passkeys yet',
  pickAccountHint: 'Pick an account to view or register passkeys',
  noAuditEvents: 'No audit events yet',
}
