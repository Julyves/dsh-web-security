/**
 * dsh-web-security client 入口：Cordis 约定字段 + 设置页装配（M4）。
 *
 * 装配顺序（指南 7.2 防死锁范式——自提供的 remote 服务必须经 child fiber
 * inject 声明后访问，宿主属性代理对未声明服务直接拦截）：
 *   1. 注册 settings.security 词典（zh/en）；
 *   2. $mount remote 贡献（fire-and-forget + 失败留痕）；
 *   3. $mount 完成后 child fiber `ctx.inject(['remote.security'])`：
 *      服务就绪且属性访问放行 → 构建 api 面（引用稳定，一次构建）→
 *      经 slots.inject 等待宿主 settings.section 声明后注册「安全」页。
 */
import type { Context } from '@deepseek-ai/cordis'
import { SecuritySection, type SecurityStatusView } from './settings/SecuritySection.tsx'
import type { AccountSummaryView } from './settings/AccountsBlock.tsx'
import type { PasskeyView } from './settings/PasskeysBlock.tsx'
import type { SecuritySettingsView } from './settings/PolicyBlock.tsx'
import type { AuditPage } from './settings/AuditBlock.tsx'
import { securityRemoteContribution } from './remote'
import { zh, en } from './locales'

/** Cordis 插件约定：声明需要的服务。 */
export const inject = ['slots', 'remote', 'locale'] as const

/** 插件标识（与包名一致）。 */
export const name = 'dsh-web-security'

/** 词典命名空间。 */
const NS = 'settings.security'

type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }
type SecurityWire = Record<string, (request: unknown) => Promise<unknown>>

/** client remote 调用返回 gateway 信封（RpcResult）——解出业务载荷。
 * 实机回归：未解包时查询类拿到 {ok,value} 对象，UI 直接 .map 即崩白屏。 */
async function unwrap<T>(p: Promise<{ ok: true; value: T } | { ok: false; error: { code: string; message: string } }>): Promise<T> {
  const r = await p
  if (!r.ok) throw new Error(r.error?.message ?? `remote 调用失败（${r.error?.code ?? 'unknown'}）`)
  return r.value
}

/** 从已就绪的 remote.security 命名空间构建注入面（一次构建，引用稳定）。
 *
 * 语义分层：查询类端点（宿主直返业务值）unwrap 后得业务值；写类端点
 * （宿主返回业务 RemoteEnvelope）unwrap 后得业务信封——UI 据信封呈现
 * ok/error（信封 wire 契约见 host-endpoints RemoteEnvelope 注释）。 */
function buildFace(security: SecurityWire, t: (key: string) => string): Record<string, unknown> {
  /** 取命名空间方法（child fiber 内缺失属编程错误——大声失败，异步化兜进区块错误态）。 */
  const call = (method: string): (request: unknown) => Promise<unknown> => {
    const fn = security[method]
    if (fn === undefined) {
      return async () => { throw new Error(`web-security: remote.security.${method} 不可用（贡献未挂载）`) }
    }
    return fn
  }
  return {
    t,
    loadStatus: async (): Promise<SecurityStatusView> => unwrap(call('status')({}) as Promise<{ ok: true; value: SecurityStatusView }>),
    accounts: {
      loadAccounts: async () => unwrap(call('accountsList')({}) as Promise<{ ok: true; value: readonly AccountSummaryView[] }>),
      createAccount: (username: string, password: string) =>
        unwrap(call('accountCreate')({ username, password }) as Promise<{ ok: true; value: Envelope<void> }>) as unknown as Promise<Envelope<void>>,
      updatePassword: (username: string, currentPassword: string, newPassword: string) =>
        unwrap(call('accountUpdatePassword')({ username, currentPassword, newPassword }) as Promise<{ ok: true; value: Envelope<void> }>) as unknown as Promise<Envelope<void>>,
      removeAccount: (username: string) =>
        unwrap(call('accountRemove')({ username }) as Promise<{ ok: true; value: Envelope<void> }>) as unknown as Promise<Envelope<void>>,
    },
    passkeys: {
      loadAccounts: async () => unwrap(call('accountsList')({}) as Promise<{ ok: true; value: readonly AccountSummaryView[] }>),
      listPasskeys: (username: string) =>
        unwrap(call('listPasskeys')({ username }) as Promise<{ ok: true; value: readonly PasskeyView[] }>),
      registerBegin: (username: string) =>
        unwrap(call('passkeyRegisterBegin')({ username }) as Promise<{ ok: true; value: Envelope<Record<string, unknown>> }>) as unknown as Promise<Envelope<Record<string, unknown>>>,
      registerComplete: (username: string, credential: unknown) =>
        unwrap(call('passkeyRegisterComplete')({ username, credential }) as Promise<{ ok: true; value: Envelope<void> }>) as unknown as Promise<Envelope<void>>,
      removePasskey: (username: string, credentialId: string) =>
        unwrap(call('passkeyRemove')({ username, credentialId }) as Promise<{ ok: true; value: Envelope<void> }>) as unknown as Promise<Envelope<void>>,
    },
    policy: {
      readSettings: () => unwrap(call('settingsRead')({}) as Promise<{ ok: true; value: SecuritySettingsView }>),
      writeSettings: (partial: Partial<SecuritySettingsView>) =>
        unwrap(call('settingsWrite')(partial) as Promise<{ ok: true; value: Envelope<SecuritySettingsView> }>) as unknown as Promise<Envelope<SecuritySettingsView>>,
    },
    audit: {
      readAudit: (offset: number, limit: number) =>
        unwrap(call('auditRead')({ offset, limit }) as Promise<{ ok: true; value: AuditPage }>),
    },
  }
}

/** Cordis 插件入口：词典 → remote 贡献挂载 → child fiber 消费 → 设置页注册。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-security: dictionaries')

  const t = ctx.locale.bind(NS)

  // remote 贡献挂载（失败留痕——贡献形状错误等编程错误大声暴露）。
  void ctx.remote.$mount(securityRemoteContribution)
    .then((dispose) => {
      ctx.effect(() => dispose, 'web-security: remote contribution')
      // child fiber：声明 remote.security 后属性访问放行（宿主守卫
      // 「cannot get property ... without inject」——实机白屏根因）。
      ctx.inject(['remote.security'], (child) => {
        const security = (child as unknown as { remote: { security: SecurityWire } }).remote.security
        const face = buildFace(security, t)
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'security',
          order: 100,
          label: () => t('page'),
          locale: NS,
          inject: () => face,
        }, SecuritySection as never))
      })
    })
    .catch((error: unknown) => {
      console.error('web-security: remote 贡献挂载失败', error)
    })
}
