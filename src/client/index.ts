/**
 * dsh-web-security client 入口：Cordis 约定字段 + 设置页装配（M4）。
 *
 * 装配顺序：
 *   1. 注册 settings.security 词典（zh/en）；
 *   2. 经 slots.inject 等待宿主 settings.section 声明后注册「安全」页
 *      （id=security；label thunk 跟随 locale）。
 *
 * remote 消费（remote.security）由后续纵切经 inject 面闭包接入；
 * 主 fiber inject 不声明 remote.security（防自挂载服务死锁——指南 7.2）。
 */
import type { Context } from '@deepseek-ai/cordis'
import { SecuritySection, type SecurityStatusView } from './settings/SecuritySection.tsx'
import type { AccountSummaryView } from './settings/AccountsBlock.tsx'
import { securityRemoteContribution } from './remote'
import { zh, en } from './locales'

/** remote.security 的动态代理视图（挂载后可调；消费点在 inject 闭包）。 */
function securityRemote(ctx: Context): Record<string, (request: unknown) => Promise<unknown>> {
  return (ctx.remote as unknown as { security: Record<string, (request: unknown) => Promise<unknown>> }).security
}

/** 取命名空间方法（缺失时抛错——$mount 未完成即调用属编程错误，大声失败）。 */
function securityMethod(ctx: Context, method: string): (request: unknown) => Promise<unknown> {
  const fn = securityRemote(ctx)[method]
  if (fn === undefined) throw new Error(`web-security: remote.security.${method} 不可用（贡献未挂载）`)
  return fn
}

/** Cordis 插件约定：声明需要的服务。 */
export const inject = ['slots', 'remote', 'locale'] as const

/** 插件标识（与包名一致）。 */
export const name = 'dsh-web-security'

/** 词典命名空间。 */
const NS = 'settings.security'

/** Cordis 插件入口：注册词典 + remote 贡献 + 设置页槽位贡献。 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'web-security: dictionaries')

  // remote 贡献挂载（fire-and-forget；消费在组件 inject 闭包经
  // ctx.remote.security 动态代理——不经主 fiber inject 静态等待，防死锁）。
  void ctx.remote.$mount(securityRemoteContribution).then((dispose) => {
    ctx.effect(() => dispose, 'web-security: remote contribution')
  })

  const t = ctx.locale.bind(NS)

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'security',
    order: 100,
    label: () => t('page'),
    locale: NS,
    inject: () => ({
      t,
      loadStatus: async (): Promise<SecurityStatusView> => {
        const remote = (ctx.remote as unknown as { security: { status: (request: unknown) => Promise<SecurityStatusView> } }).security
        return remote.status({})
      },
      accounts: {
        loadAccounts: async () => securityMethod(ctx, 'accountsList')({}) as Promise<readonly AccountSummaryView[]>,
        createAccount: (username: string, password: string) =>
          securityMethod(ctx, 'accountCreate')({ username, password }) as Promise<{ ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }>,
        updatePassword: (username: string, currentPassword: string, newPassword: string) =>
          securityMethod(ctx, 'accountUpdatePassword')({ username, currentPassword, newPassword }) as Promise<{ ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }>,
        removeAccount: (username: string) =>
          securityMethod(ctx, 'accountRemove')({ username }) as Promise<{ ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }>,
      },
      passkeys: {
        loadAccounts: async () => securityMethod(ctx, 'accountsList')({}) as Promise<readonly AccountSummaryView[]>,
        listPasskeys: (username: string) =>
          securityMethod(ctx, 'listPasskeys')({ username }) as Promise<readonly { credentialId: string }[]>,
        registerBegin: (username: string) =>
          securityMethod(ctx, 'passkeyRegisterBegin')({ username }) as Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: { code: string; message: string } }>,
        registerComplete: (username: string, credential: unknown) =>
          securityMethod(ctx, 'passkeyRegisterComplete')({ username, credential }) as Promise<{ ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }>,
        removePasskey: (username: string, credentialId: string) =>
          securityMethod(ctx, 'passkeyRemove')({ username, credentialId }) as Promise<{ ok: true; value: undefined } | { ok: false; error: { code: string; message: string } }>,
      },
      policy: {
        readSettings: () => securityMethod(ctx, 'settingsRead')({}) as Promise<import('./settings/PolicyBlock').SecuritySettingsView>,
        writeSettings: (partial: Partial<import('./settings/PolicyBlock').SecuritySettingsView>) =>
          securityMethod(ctx, 'settingsWrite')(partial) as Promise<{ ok: true; value: import('./settings/PolicyBlock').SecuritySettingsView } | { ok: false; error: { code: string; message: string } }>,
      },
      audit: {
        readAudit: (offset: number, limit: number) =>
          securityMethod(ctx, 'auditRead')({ offset, limit }) as Promise<{ events: readonly { kind: string; at: number; actor: string; ip?: string; detail?: string }[]; hasMore: boolean }>,
      },
    }),
  }, SecuritySection as never))
}
