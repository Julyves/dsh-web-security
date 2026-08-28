// @vitest-environment jsdom
/**
 * 设置页 seam 测试（M4）：真实构建产物 lib/client.js 在 jsdom 中的
 * 挂载与交互。
 *
 * 规格：.scratch/m4-settings-ui/spec.md（test_seam）。
 * 加载 ModuleLoader 闭包格式的真实 bundle，stub 平台模块表
 * （ui-primitives 原语用原生元素替身；react 系真实加载），
 * 断言用户可观察行为。
 */
import { describe, expect, it, vi, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import * as ReactDOMClient from 'react-dom/client'
import { act } from 'react'
import type { FC, ReactNode } from 'react'

/** 项目内 require（真实加载 react 系）。 */
const nodeRequire = createRequire(join(process.cwd(), 'package.json'))

/** stub ui-primitives 原语：透传 children 的原生替身（保留 data-prim 标记）。 */
function primStub(tag: string): FC<{ children?: ReactNode; [key: string]: unknown }> {
  return function PrimStub(props) {
    const { children, ...rest } = props
    return h(tag, { ...rest as Record<string, string>, 'data-prim': tag }, children)
  }
}

/** Input stub：遵守宿主 Input 契约——onChange(value: string)，从原生事件适配。 */
function InputStub(props: { value?: string; onChange?: (value: string) => void; [key: string]: unknown }): ReactNode {
  const { children, onChange, ...rest } = props
  void children
  return h('input', {
    ...rest as Record<string, string>,
    value: props.value ?? '',
    onChange: (event: { target: { value: string } }) => onChange?.(event.target.value),
  })
}

/** RiskConfirmation stub：渲染确认/取消按钮（data-action 断言面），遵守 {confirm, cancel} 契约。 */
function RiskConfirmationStub(props: { children?: ReactNode; confirm?: () => void; cancel?: () => void; [key: string]: unknown }): ReactNode {
  const { children, confirm, cancel } = props
  return h('div', { 'data-prim': 'risk' },
    children,
    h('button', { 'data-action': 'risk-confirm', onClick: () => confirm?.() }, '确认'),
    h('button', { 'data-action': 'risk-cancel', onClick: () => cancel?.() }, '取消'),
  )
}

/** 极小 createElement（避免依赖 jsx 转换细节）。 */
function h(tag: string, props: Record<string, unknown> | null, ...children: ReactNode[]): ReactNode {
  return { $$typeof: Symbol.for('react.transitional.element'), type: tag, key: null, props: { ...props, children: children.length === 0 ? undefined : children.length === 1 ? children[0] : children } } as ReactNode
}

/** seam 基建：加载 bundle 并捕获 apply 面。 */
function loadBundle(): {
  exports: { name: string; inject: readonly string[]; apply: (ctx: unknown) => void | Promise<void> }
  platformRequire: (spec: string) => unknown
} {
  const code = readFileSync(join(process.cwd(), 'lib/client.js'), 'utf8')
  let capturedFactory: ((require: (spec: string) => unknown) => unknown) | undefined
  const loaderStub = {
    load(entry: { id: string; factory: (require: (spec: string) => unknown) => unknown }): void {
      expect(entry.id).toBe('dsh-web-security')
      capturedFactory = entry.factory
    },
  }
  ;(window as unknown as { __ModuleLoader__: unknown }).__ModuleLoader__ = loaderStub
  // 平台模块表：react 系真实；宿主原语 stub。
  const platformModules: Record<string, unknown> = {
    'react': nodeRequire('react'),
    'react/jsx-runtime': nodeRequire('react/jsx-runtime'),
    'react-dom': nodeRequire('react-dom'),
    'react-dom/client': nodeRequire('react-dom/client'),
    '@deepseek-ai/cordis': { Context: {} },
    '@deepseek-ai/dsh-client-ui-slots': {},
    '@deepseek-ai/dsh-client-ui-primitives': {
      Button: primStub('button'),
      Input: InputStub as unknown as FC<never>,
      Pill: primStub('span'),
      DisclosureRow: primStub('div'),
      RiskConfirmation: RiskConfirmationStub as unknown as FC<never>,
    },
  }
  // eval bundle 源码（闭包捕获 window.__ModuleLoader__ 与 var module）。
  const run = new Function('window', `"use strict"\n${code}`) as (w: unknown) => void
  run(window)
  if (capturedFactory === undefined) throw new Error('bundle 未调用 __ModuleLoader__.load')
  const exports = capturedFactory((spec: string) => {
    const mod = platformModules[spec]
    if (mod === undefined) throw new Error(`seam 测试未提供平台模块: ${spec}`)
    return mod
  }) as { name: string; inject: readonly string[]; apply: (ctx: unknown) => void | Promise<void> }
  return { exports, platformRequire: (spec: string) => platformModules[spec] }
}

/** zh 词典（与实现 locales 对齐的断言字面量）。 */
const ZH: Record<string, string> = {
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
  downgradeConfirm: '本次变更会削弱安全姿态，确认执行？',
}

/** en 词典（Story 2b 断言字面量）。 */
const EN: Record<string, string> = {
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
  webauthnUnavailable: 'Passkeys are unavailable in this context',
  policyTitle: 'Security policy',
  auditTitle: 'Audit log',
  retry: 'Retry',
  loadMore: 'Load more',
  save: 'Save',
  downgradeConfirm: 'This change weakens the security posture. Proceed?',
}

/** 设置受控 input 的值并派发 input 事件（React 兼容路径）。 */
function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  setter?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

/** 构造 stub client ctx。 */
function makeCtx(overrides: { remoteSecurity?: Record<string, unknown>; locale?: 'zh' | 'en' } = {}) {
  const dict: Record<string, string> = overrides.locale === 'en' ? EN : ZH
  const slotFactories = new Map<string, () => unknown>()
  const registerCalls: { options: { name: string; id?: string; order?: number; inject?: () => Record<string, unknown> }; component: unknown }[] = []
  const ctx = {
    effect: vi.fn((cb: () => unknown) => { const d = cb(); return typeof d === 'function' ? d : undefined }),
    locale: {
      register: vi.fn<(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }) => () => void>(() => () => {}),
      bind: vi.fn((ns: string) => (key: string) => (ns === 'settings.security' ? dict[key] ?? key : key)),
    },
    inject: vi.fn((keys: readonly string[], cb: (c: unknown) => void) => { cb(ctx) }),
    slots: {
      inject: vi.fn((name: string, factory: () => unknown) => { slotFactories.set(name, factory) }),
      register: vi.fn((options: { name: string; id?: string; order?: number; inject?: () => Record<string, unknown> }, component: unknown) => {
        registerCalls.push({ options, component })
        return () => {}
      }),
    },
    remote: (() => {
      // 真实 RemoteStore 返回 gateway 信封 RpcResult（{ok:true,value:业务载荷}）。
      // 实机回归：face 未解包时 accounts.map 炸白屏。各 describe 的 override
      // 书写业务载荷（查询类为业务值、写类为业务信封）即可，包装器统一包 gateway 信封。
      const raw: Record<string, unknown> = {
        status: async () => ({ enabled: true, diagnostics: [] }),
        accountsList: async () => [],
        listPasskeys: async () => [{ credentialId: 'stubCredAAAA' }],
        settingsRead: async () => DEFAULT_SETTINGS_SAMPLE,
        auditRead: async () => ({ events: [], hasMore: false }),
        ...(overrides.remoteSecurity ?? {}),
      }
      const security = new Proxy(raw, {
        get(target, prop: string) {
          const v = target[prop]
          if (typeof v !== 'function') return v
          return async (...args: unknown[]) => {
            const r = await (v as (...a: unknown[]) => unknown)(...args)
            return { ok: true, value: r }
          }
        },
      })
      return {
        $mount: vi.fn<(contribution: unknown) => Promise<() => void>>(async () => () => {}),
        security,
      }
    })(),
  }
  return { ctx, slotFactories, registerCalls }
}

/** 挂载并渲染设置页组件（四股合成：owner close + inject 面展开）。 */
async function renderSection(ctx: ReturnType<typeof makeCtx>['ctx'], slotFactories: Map<string, () => unknown>, registerCalls: ReturnType<typeof makeCtx>['registerCalls']): Promise<HTMLDivElement> {
  // apply 的 slot 注册发生在 $mount.then → ctx.inject 回调内（child fiber
  // 范式）——先冲刷微任务让注册落地。
  await new Promise<void>(r => setTimeout(r, 0))
  ;(slotFactories.get('settings.section') as () => unknown)()
  const Component = registerCalls[0]?.component as FC<Record<string, unknown>>
  const injectFace = (ctx.slots.register.mock.calls[0]?.[0] as { inject?: () => Record<string, unknown> }).inject?.() ?? {}
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    const root = ReactDOMClient.createRoot(container)
    root.render({ $$typeof: Symbol.for('react.transitional.element'), type: Component, key: null, props: { close: () => {}, ...injectFace } } as never)
  })
  return container
}

describe('Story 1：设置页挂载（lib/client.js seam）', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('bundle 出口：name/inject/apply 契约', () => {
    expect(bundle.exports.name).toBe('dsh-web-security')
    expect(bundle.exports.inject).toContain('slots')
    expect(bundle.exports.inject).toContain('locale')
    expect(typeof bundle.exports.apply).toBe('function')
  })

  it('apply：注册词典 + $mount 后经 child inject 注册槽位', async () => {
    const { ctx } = makeCtx()
    bundle.exports.apply(ctx)
    expect(ctx.locale.register).toHaveBeenCalledWith('settings.security', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    await new Promise<void>(r => setTimeout(r, 0))
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
  })

  it('槽位注册：name=settings.section、id=security、label 跟随词典', async () => {
    const { ctx, slotFactories, registerCalls } = makeCtx()
    bundle.exports.apply(ctx)
    await new Promise<void>(r => setTimeout(r, 0))
    const factory = slotFactories.get('settings.section')
    expect(factory).toBeDefined()
    ;(factory as () => unknown)()
    expect(registerCalls).toHaveLength(1)
    expect(registerCalls[0]?.options.name).toBe('settings.section')
    expect(registerCalls[0]?.options.id).toBe('security')
    const label = (ctx.slots.register.mock.calls[0]?.[0] as { label?: () => string }).label
    expect(typeof label).toBe('function')
    expect((label as () => string)()).toBe('安全')
  })

  it('组件渲染：五区块标题可见（横幅/账号/通行密钥/策略/审计）', async () => {
    const { ctx, slotFactories, registerCalls } = makeCtx()
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const text = container.textContent ?? ''
    // 逐字面量断言（来自规格独立期望，非实现算法）。
    expect(text).toContain('账号管理')
    expect(text).toContain('通行密钥')
    expect(text).toContain('安全策略')
    expect(text).toContain('审计日志')
    container.remove()
  })
})

describe('Story 2a：诊断横幅（remote 接线）', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('diagnostics 非空 → 红色横幅逐条渲染警告文本', async () => {
    const warning = 'host-webserver 绑定 0.0.0.0:3080：LAN 设备可绕过认证门直连 3080 API（改绑 127.0.0.1）'
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { status: async () => ({ enabled: true, diagnostics: [warning] }) },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const text = container.textContent ?? ''
    expect(text).toContain('部署警告')
    expect(text).toContain(warning)
    const banner = container.querySelector('[data-banner]')
    expect(banner).not.toBeNull()
    container.remove()
  })

  it('diagnostics 为空 → 无横幅区块', async () => {
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { status: async () => ({ enabled: true, diagnostics: [] }) },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    expect(container.querySelector('[data-banner]')).toBeNull()
    container.remove()
  })

  it('status 调用失败 → 错误态提示而非崩溃', async () => {
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { status: async () => { throw new Error('网络断') } },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    expect(container.textContent ?? '').toContain('状态加载失败')
    container.remove()
  })

  it('remote 贡献经 $mount 挂载（TypertRemoteContribution 真实 schema）', async () => {
    const { ctx } = makeCtx()
    bundle.exports.apply(ctx)
    await new Promise<void>(r => setTimeout(r, 0))
    expect(ctx.remote.$mount).toHaveBeenCalled()
    const contribution = (ctx.remote.$mount.mock.calls[0]?.[0]) as { package?: string; descriptors?: unknown[] }
    // 真实运行时（typert registry）校验：package 必填（validateSegment 读
    // package.length——实机回归：缺失即 Uncaught TypeError，贡献挂载失败，
    // ctx.remote.security 不存在，设置页数据面瘫痪）。
    expect(contribution?.package).toBe('dsh-web-security')
    expect(Array.isArray(contribution?.descriptors)).toBe(true)
    expect((contribution?.descriptors ?? []).length).toBeGreaterThan(0)
  })

  it('$mount 后经 child fiber inject 声明 remote.security（宿主属性代理守卫——实机回归）', async () => {
    const { ctx } = makeCtx()
    bundle.exports.apply(ctx)
    await new Promise<void>(r => setTimeout(r, 0))
    // 宿主守卫：ctx.remote.security 未声明 inject 直接属性访问即抛
    // cannot get property "remote.security" without inject → entry crash →
    // SlotErrorBoundary 空白（实机白屏根因）。
    expect(ctx.inject).toHaveBeenCalledWith(['remote.security'], expect.any(Function))
  })
})

describe('Story 2b：locale 切换', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('en 词典 → 区块标题为英文', async () => {
    const { ctx, slotFactories, registerCalls } = makeCtx({ locale: 'en' })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const text = container.textContent ?? ''
    expect(text).toContain('Accounts')
    expect(text).toContain('Audit log')
    container.remove()
  })

  it('实现词典：en 与 zh key 集一致（防漏译守护）', () => {
    const { ctx } = makeCtx()
    bundle.exports.apply(ctx)
    const call = ctx.locale.register.mock.calls[0]
    const dicts = call?.[1] as { zh: Record<string, string>; en: Record<string, string> }
    expect(Object.keys(dicts.en).sort()).toEqual(Object.keys(dicts.zh).sort())
  })
})

describe('Story 3：账号管理', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('初始渲染：accountsList 调用 + 列表显示用户名', async () => {
    const accountsList = vi.fn(async () => [
      { username: 'admin', hasPasskey: false, createdAt: 1700000000000 },
    ])
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    expect(accountsList).toHaveBeenCalledWith({})
    expect(container.textContent ?? '').toContain('admin')
    container.remove()
  })

  it('创建账号：填表提交 → accountCreate 参数正确 + 列表刷新出现新账号', async () => {
    let accounts = [{ username: 'admin', hasPasskey: false, createdAt: 1 }]
    const accountsList = vi.fn(async () => accounts)
    const accountCreate = vi.fn(async (request: { username: string; password: string }) => {
      accounts = [...accounts, { username: request.username, hasPasskey: false, createdAt: 2 }]
      return { ok: true, value: undefined }
    })
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList, accountCreate },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const block = container.querySelector('[data-block="accounts"]')
    expect(block).not.toBeNull()
    const inputs = Array.from(block?.querySelectorAll('input') ?? []) as HTMLInputElement[]
    expect(inputs.length).toBeGreaterThanOrEqual(2)
    await act(async () => {
      setInputValue(inputs[0] as HTMLInputElement, 'newuser')
    })
    await act(async () => {
      setInputValue(inputs[1] as HTMLInputElement, 'SecurePass123!')
    })
    const btn = container.querySelector<HTMLButtonElement>('button[data-action="account-create"]')
    expect(btn).not.toBeNull()
    expect(btn?.disabled).toBe(false)
    await act(async () => {
      btn?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(accountCreate).toHaveBeenCalledWith({ username: 'newuser', password: 'SecurePass123!' })
    expect(container.textContent ?? '').toContain('newuser')
    container.remove()
  })

  it('创建失败：host 错误信息呈现于表单', async () => {
    const accountsList = vi.fn(async () => [])
    const accountCreate = vi.fn(async () => ({ ok: false, error: { code: 'create-failed', message: '密码强度不足：至少 12 字符' } }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList, accountCreate },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const inputs = Array.from(container.querySelectorAll('[data-block="accounts"] input')) as HTMLInputElement[]
    await act(async () => { setInputValue(inputs[0] as HTMLInputElement, 'x') })
    await act(async () => { setInputValue(inputs[1] as HTMLInputElement, 'y') })
    const btn = container.querySelector<HTMLButtonElement>('button[data-action="account-create"]')
    await act(async () => { btn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent ?? '').toContain('密码强度不足：至少 12 字符')
    container.remove()
  })

  it('账号加载失败：区块错误态呈现', async () => {
    const accountsList = vi.fn(async () => { throw new Error('网络断') })
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const block = container.querySelector('[data-block="accounts"]')
    expect(block?.getAttribute('data-state')).toBe('error')
    expect(block?.textContent ?? '').toContain('加载失败')
    container.remove()
  })
})

describe('Story 4：修改密码', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('行内改密表单提交 → accountUpdatePassword 参数正确 + 成功提示', async () => {
    const accountsList = vi.fn(async () => [
      { username: 'admin', hasPasskey: false, createdAt: 1 },
    ])
    const accountUpdatePassword = vi.fn(async () => ({ ok: true, value: undefined }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList, accountUpdatePassword },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    // 打开 admin 行的改密表单。
    const openBtn = container.querySelector<HTMLButtonElement>('button[data-action="password-open"][data-username="admin"]')
    expect(openBtn).not.toBeNull()
    await act(async () => { openBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const form = container.querySelector('[data-role="password-edit"][data-username="admin"]')
    expect(form).not.toBeNull()
    const inputs = Array.from(form?.querySelectorAll('input') ?? []) as HTMLInputElement[]
    await act(async () => { setInputValue(inputs[0] as HTMLInputElement, 'OldPass123!') })
    await act(async () => { setInputValue(inputs[1] as HTMLInputElement, 'NewPass456!') })
    const submit = form?.querySelector<HTMLButtonElement>('button[data-action="password-submit"]')
    await act(async () => { submit?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(accountUpdatePassword).toHaveBeenCalledWith({
      username: 'admin', currentPassword: 'OldPass123!', newPassword: 'NewPass456!',
    })
    expect(container.textContent ?? '').toContain('已更新')
    container.remove()
  })

  it('旧密码错误 → host 错误信息呈现', async () => {
    const accountsList = vi.fn(async () => [{ username: 'admin', hasPasskey: false, createdAt: 1 }])
    const accountUpdatePassword = vi.fn(async () => ({ ok: false, error: { code: 'update-failed', message: '当前密码不正确' } }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList, accountUpdatePassword },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const openBtn = container.querySelector<HTMLButtonElement>('button[data-action="password-open"][data-username="admin"]')
    await act(async () => { openBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const form = container.querySelector('[data-role="password-edit"][data-username="admin"]')
    const inputs = Array.from(form?.querySelectorAll('input') ?? []) as HTMLInputElement[]
    await act(async () => { setInputValue(inputs[0] as HTMLInputElement, 'WrongOld1!') })
    await act(async () => { setInputValue(inputs[1] as HTMLInputElement, 'NewPass456!') })
    const submit = form?.querySelector<HTMLButtonElement>('button[data-action="password-submit"]')
    await act(async () => { submit?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent ?? '').toContain('当前密码不正确')
    container.remove()
  })
})

describe('Story 5：删除账号（RiskConfirmation）', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('点删除 → 风险确认出现 → 确认 → accountRemove 调用 + 列表移除', async () => {
    let accounts = [
      { username: 'admin', hasPasskey: false, createdAt: 1 },
      { username: 'temp', hasPasskey: false, createdAt: 2 },
    ]
    const accountsList = vi.fn(async () => accounts)
    const accountRemove = vi.fn(async (request: { username: string }) => {
      accounts = accounts.filter(a => a.username !== request.username)
      return { ok: true, value: undefined }
    })
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList, accountRemove },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const delBtn = container.querySelector<HTMLButtonElement>('button[data-action="remove-open"][data-username="temp"]')
    expect(delBtn).not.toBeNull()
    await act(async () => { delBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 风险确认容器出现（RiskConfirmation stub）。
    const risk = container.querySelector('[data-prim="risk"]')
    expect(risk).not.toBeNull()
    const confirmBtn = risk?.querySelector<HTMLButtonElement>('button[data-action="risk-confirm"]')
    await act(async () => { confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(accountRemove).toHaveBeenCalledWith({ username: 'temp' })
    const accountsText = container.querySelector('[data-block="accounts"]')?.textContent ?? ''
    expect(accountsText).not.toContain('temp')
    expect(accountsText).toContain('admin')
    container.remove()
  })

  it('取消确认 → accountRemove 不被调用', async () => {
    const accountsList = vi.fn(async () => [{ username: 'admin', hasPasskey: false, createdAt: 1 }])
    const accountRemove = vi.fn(async () => ({ ok: true, value: undefined }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList, accountRemove },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const delBtn = container.querySelector<HTMLButtonElement>('button[data-action="remove-open"][data-username="admin"]')
    await act(async () => { delBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const cancelBtn = container.querySelector<HTMLButtonElement>('button[data-action="risk-cancel"]')
    await act(async () => { cancelBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(accountRemove).not.toHaveBeenCalled()
    expect(container.textContent ?? '').toContain('admin')
    container.remove()
  })

  it('删除失败 → 错误呈现且账号保留', async () => {
    const accountsList = vi.fn(async () => [{ username: 'admin', hasPasskey: false, createdAt: 1 }])
    const accountRemove = vi.fn(async () => ({ ok: false, error: { code: 'remove-failed', message: '不能删除最后一个账号？' } }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList, accountRemove },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const delBtn = container.querySelector<HTMLButtonElement>('button[data-action="remove-open"][data-username="admin"]')
    await act(async () => { delBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const confirmBtn = container.querySelector<HTMLButtonElement>('button[data-action="risk-confirm"]')
    await act(async () => { confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent ?? '').toContain('不能删除最后一个账号？')
    expect(container.textContent ?? '').toContain('admin')
    container.remove()
  })
})

/** 构造 WebAuthn 可用环境（stub navigator.credentials + isSecureContext）。 */
function enableWebAuthn(create: () => Promise<unknown>): void {
  Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true })
  Object.defineProperty(window.navigator, 'credentials', {
    value: { create },
    configurable: true,
  })
}

/** 恢复 WebAuthn 不可用环境（清除 stub；jsdom 原生 isSecureContext 为 undefined）。 */
function disableWebAuthn(): void {
  Object.defineProperty(window, 'isSecureContext', { value: undefined, configurable: true })
  delete (window.navigator as { credentials?: unknown }).credentials
}

/** 构造 stub 注册凭证（rawId/response 各字段为 ArrayBuffer，如浏览器真形态）。 */
function fakeRegistrationCredential(): unknown {
  const bytes = (s: string): ArrayBuffer => { const b = new Uint8Array([...s].map(c => c.charCodeAt(0))); return b.buffer }
  return {
    id: 'cred-1',
    rawId: bytes('rawid'),
    type: 'public-key',
    clientExtensionResults: {},
    response: { clientDataJSON: bytes('client'), attestationObject: bytes('attest') },
  }
}

describe('Story 6/7/8：通行密钥管理', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('Story 6：选账号点注册 → begin + WebAuthn create + complete 全链调用', async () => {
    const credentialsCreate = vi.fn(async () => fakeRegistrationCredential())
    enableWebAuthn(credentialsCreate)
    const passkeyRegisterBegin = vi.fn(async () => ({
      ok: true,
      value: { challenge: 'YWJj', rp: { name: 'dsh' }, user: { id: 'dXNlcg', name: 'admin', displayName: 'admin' }, pubKeyCredParams: [] },
    }))
    const passkeyRegisterComplete = vi.fn(async () => ({ ok: true, value: undefined }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: {
        accountsList: vi.fn(async () => [{ username: 'admin', hasPasskey: false, createdAt: 1 }]),
        passkeyRegisterBegin, passkeyRegisterComplete,
      },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    // 选择账号。
    const pick = container.querySelector<HTMLButtonElement>('button[data-action="passkey-account"][data-username="admin"]')
    expect(pick).not.toBeNull()
    await act(async () => { pick?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const registerBtn = container.querySelector<HTMLButtonElement>('button[data-action="passkey-register"]')
    expect(registerBtn).not.toBeNull()
    expect(registerBtn?.disabled).toBe(false)
    await act(async () => { registerBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(passkeyRegisterBegin).toHaveBeenCalledWith({ username: 'admin' })
    expect(credentialsCreate).toHaveBeenCalled()
    expect(passkeyRegisterComplete).toHaveBeenCalledWith({
      username: 'admin',
      credential: expect.objectContaining({ rawId: expect.any(String), type: 'public-key' }),
    })
    container.remove()
  })

  it('Story 7：凭证列表 + 移除 → passkeyRemove 调用 + 列表刷新', async () => {
    let creds = [{ credentialId: 'credAAAAAAAA' }, { credentialId: 'credBBBBBBBB' }]
    const listPasskeysCall = vi.fn(async () => creds)
    // remote 侧无独立 listPasskeys 端点——经 accountsList + passkey 面；此处 stub 命名空间方法。
    const passkeyRemove = vi.fn(async () => {
      creds = creds.filter(c => c.credentialId !== 'credAAAAAAAA')
      return { ok: true, value: undefined }
    })
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: {
        accountsList: vi.fn(async () => [{ username: 'admin', hasPasskey: true, createdAt: 1 }]),
        listPasskeys: listPasskeysCall,
        passkeyRemove,
      },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const pick = container.querySelector<HTMLButtonElement>('button[data-action="passkey-account"][data-username="admin"]')
    await act(async () => { pick?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(listPasskeysCall).toHaveBeenCalledWith({ username: 'admin' })
    expect(container.textContent ?? '').toContain('credAAAAAAAA')
    const removeBtn = container.querySelector<HTMLButtonElement>('button[data-action="passkey-remove"][data-credential="credAAAAAAAA"]')
    expect(removeBtn).not.toBeNull()
    await act(async () => { removeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(passkeyRemove).toHaveBeenCalledWith({ username: 'admin', credentialId: 'credAAAAAAAA' })
    expect(container.textContent ?? '').not.toContain('credAAAAAAAA')
    expect(container.textContent ?? '').toContain('credBBBBBBBB')
    container.remove()
  })

  it('Story 8：lockout-prevented → 自锁死解释文案呈现', async () => {
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: {
        accountsList: vi.fn(async () => [{ username: 'admin', hasPasskey: true, createdAt: 1 }]),
        listPasskeys: vi.fn(async () => [{ credentialId: 'lastCredAAAA' }]),
        passkeyRemove: vi.fn(async () => ({
          ok: false,
          error: { code: 'lockout-prevented', message: '该账号仅剩此通行密钥且密码登录已关闭，移除后将无法登录（防自锁死）' },
        })),
      },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const pick = container.querySelector<HTMLButtonElement>('button[data-action="passkey-account"][data-username="admin"]')
    await act(async () => { pick?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const removeBtn = container.querySelector<HTMLButtonElement>('button[data-action="passkey-remove"][data-credential="lastCredAAAA"]')
    await act(async () => { removeBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.textContent ?? '').toContain('防自锁死')
    container.remove()
  })
})

/** 默认设置样本（独立期望值——与实现 DEFAULT_SETTINGS 同值但独立书写）。 */
const DEFAULT_SETTINGS_SAMPLE = {
  passwordLogin: true,
  passkeyLogin: true,
  sessionTtlMinutes: 480,
  maxLoginAttempts: 5,
  rateLimitWindowMinutes: 15,
  auditEnabled: true,
}

describe('Story 9/10：安全策略表单', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('Story 9：初始渲染 settingsRead + 未改动保存按钮禁用', async () => {
    const settingsRead = vi.fn(async () => DEFAULT_SETTINGS_SAMPLE)
    const settingsWrite = vi.fn(async () => ({ ok: true, value: DEFAULT_SETTINGS_SAMPLE }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { settingsRead, settingsWrite },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    expect(settingsRead).toHaveBeenCalledWith({})
    const block = container.querySelector('[data-block="policy"]')
    expect(block).not.toBeNull()
    const save = block?.querySelector<HTMLButtonElement>('button[data-action="policy-save"]')
    expect(save?.disabled).toBe(true)
    container.remove()
  })

  it('Story 9：改一个字段 → 保存只提交该脏字段', async () => {
    const settingsWrite = vi.fn(async () => ({ ok: true, value: { ...DEFAULT_SETTINGS_SAMPLE, sessionTtlMinutes: 240 } }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { settingsRead: vi.fn(async () => DEFAULT_SETTINGS_SAMPLE), settingsWrite },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const block = container.querySelector('[data-block="policy"]')
    const ttl = block?.querySelector<HTMLInputElement>('input[data-field="sessionTtlMinutes"]')
    expect(ttl).not.toBeNull()
    await act(async () => { setInputValue(ttl as HTMLInputElement, '240') })
    const save = block?.querySelector<HTMLButtonElement>('button[data-action="policy-save"]')
    expect(save?.disabled).toBe(false)
    await act(async () => { save?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(settingsWrite).toHaveBeenCalledWith({ sessionTtlMinutes: 240 })
    container.remove()
  })

  it('Story 10：降级变更（关审计）→ RiskConfirmation 确认后才提交', async () => {
    const settingsWrite = vi.fn(async () => ({ ok: true, value: { ...DEFAULT_SETTINGS_SAMPLE, auditEnabled: false } }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { settingsRead: vi.fn(async () => DEFAULT_SETTINGS_SAMPLE), settingsWrite },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const block = container.querySelector('[data-block="policy"]')
    const auditToggle = block?.querySelector<HTMLInputElement>('input[data-field="auditEnabled"]')
    expect(auditToggle).not.toBeNull()
    await act(async () => { auditToggle?.click() })
    const save = block?.querySelector<HTMLButtonElement>('button[data-action="policy-save"]')
    await act(async () => { save?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 未确认前不提交。
    expect(settingsWrite).not.toHaveBeenCalled()
    // 风险确认出现 → 确认 → 提交。
    const confirmBtn = block?.querySelector<HTMLButtonElement>('button[data-action="risk-confirm"]')
    expect(confirmBtn).not.toBeNull()
    await act(async () => { confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(settingsWrite).toHaveBeenCalledWith({ auditEnabled: false })
    container.remove()
  })

  it('保存失败（自锁死）→ host 错误呈现', async () => {
    const settingsWrite = vi.fn(async () => ({
      ok: false,
      error: { code: 'lockout-prevented', message: '不能同时关闭密码登录与通行密钥登录（防自锁死）' },
    }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { settingsWrite },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const block = container.querySelector('[data-block="policy"]')
    const pwToggle = block?.querySelector<HTMLInputElement>('input[data-field="passwordLogin"]')
    const pkToggle = block?.querySelector<HTMLInputElement>('input[data-field="passkeyLogin"]')
    await act(async () => { pwToggle?.click() })
    await act(async () => { pkToggle?.click() })
    const save = block?.querySelector<HTMLButtonElement>('button[data-action="policy-save"]')
    await act(async () => { save?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    // 同关两个开关是自锁死方向——确认后提交被 host 拒绝。
    const confirmBtn = block?.querySelector<HTMLButtonElement>('button[data-action="risk-confirm"]')
    await act(async () => { confirmBtn?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(block?.textContent ?? '').toContain('不能同时关闭密码登录与通行密钥登录')
    container.remove()
  })
})

/** 生成 n 条审计事件样本（最新在前语义由 host 保证，样本独立构造）。 */
function auditEvents(n: number, offset = 0): { kind: string; at: number; actor: string; ip?: string; detail?: string }[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: 'login-success',
    at: 1700000000000 + offset + i,
    actor: `user${offset + i}`,
  }))
}

describe('Story 11/12：审计日志查看器', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('Story 11：首屏拉取 offset=0 limit=50 + 加载更多推进 offset + hasMore=false 隐藏按钮', async () => {
    const auditRead = vi.fn(async (request: { offset: number; limit: number }) => {
      if (request.offset === 0) return { events: auditEvents(50), hasMore: true }
      return { events: auditEvents(20, 50), hasMore: false }
    })
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { auditRead },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    expect(auditRead).toHaveBeenCalledWith({ offset: 0, limit: 50 })
    const block = container.querySelector('[data-block="audit"]')
    expect(block).not.toBeNull()
    // 首屏 50 条渲染。
    expect(block?.querySelectorAll('[data-audit-item]').length).toBe(50)
    const more = block?.querySelector<HTMLButtonElement>('button[data-action="audit-more"]')
    expect(more).not.toBeNull()
    await act(async () => { more?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(auditRead).toHaveBeenLastCalledWith({ offset: 50, limit: 50 })
    // 追加后 70 条；hasMore=false → 按钮消失。
    expect(block?.querySelectorAll('[data-audit-item]').length).toBe(70)
    expect(container.querySelector('button[data-action="audit-more"]')).toBeNull()
    container.remove()
  })

  it('Story 12：actor 含 <script> → 渲染为字面文本，DOM 无 script 注入', async () => {
    const auditRead = vi.fn(async () => ({
      events: [{
        kind: 'login-failure',
        at: 1700000000000,
        actor: '<script>alert(1)</script>',
        detail: '<img src=x onerror=alert(2)>',
      }],
      hasMore: false,
    }))
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { auditRead },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const block = container.querySelector('[data-block="audit"]')
    // 字面文本可见（React 转义）。
    expect(block?.textContent ?? '').toContain('<script>alert(1)</script>')
    // DOM 无 script 元素、无 img 元素注入。
    expect(block?.querySelectorAll('script').length).toBe(0)
    expect(block?.querySelectorAll('img').length).toBe(0)
    container.remove()
  })

  it('Story 13：auditRead 失败 → 错误态 + 重试恢复', async () => {
    let fail = true
    const auditRead = vi.fn(async () => {
      if (fail) throw new Error('网络断')
      return { events: auditEvents(3), hasMore: false }
    })
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { auditRead },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const block = container.querySelector('[data-block="audit"]')
    expect(block?.getAttribute('data-state')).toBe('error')
    expect(block?.textContent ?? '').toContain('加载失败')
    fail = false
    const retry = block?.querySelector<HTMLButtonElement>('button[data-action="audit-retry"]')
    expect(retry).not.toBeNull()
    await act(async () => { retry?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(container.querySelector('[data-block="audit"]')?.getAttribute('data-state')).toBe('ready')
    expect(container.querySelectorAll('[data-audit-item]').length).toBe(3)
    container.remove()
  })
})

describe('Story 14：WebAuthn 不可用探测', () => {
  let bundle: ReturnType<typeof loadBundle>
  beforeAll(() => {
    bundle = loadBundle()
  })

  it('无 credentials API/secure context → 注册入口禁用 + 原因文案', async () => {
    disableWebAuthn()
    const { ctx, slotFactories, registerCalls } = makeCtx({
      remoteSecurity: { accountsList: vi.fn(async () => [{ username: 'admin', hasPasskey: false, createdAt: 1 }]) },
    })
    bundle.exports.apply(ctx)
    const container = await renderSection(ctx, slotFactories, registerCalls)
    const pick = container.querySelector<HTMLButtonElement>('button[data-action="passkey-account"][data-username="admin"]')
    await act(async () => { pick?.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const registerBtn = container.querySelector<HTMLButtonElement>('button[data-action="passkey-register"]')
    expect(registerBtn).not.toBeNull()
    expect(registerBtn?.disabled).toBe(true)
    expect(container.textContent ?? '').toContain('此环境不支持通行密钥')
    container.remove()
  })
})
