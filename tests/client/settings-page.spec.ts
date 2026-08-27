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
  policyTitle: '安全策略',
  auditTitle: '审计日志',
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
  policyTitle: 'Security policy',
  auditTitle: 'Audit log',
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
    slots: {
      inject: vi.fn((name: string, factory: () => unknown) => { slotFactories.set(name, factory) }),
      register: vi.fn((options: { name: string; id?: string; order?: number; inject?: () => Record<string, unknown> }, component: unknown) => {
        registerCalls.push({ options, component })
        return () => {}
      }),
    },
    remote: {
      $mount: vi.fn<(contribution: unknown) => Promise<() => void>>(async () => () => {}),
      security: { status: async () => ({ enabled: true, diagnostics: [] }), ...(overrides.remoteSecurity ?? {}) },
    },
  }
  return { ctx, slotFactories, registerCalls }
}

/** 挂载并渲染设置页组件（四股合成：owner close + inject 面展开）。 */
async function renderSection(ctx: ReturnType<typeof makeCtx>['ctx'], slotFactories: Map<string, () => unknown>, registerCalls: ReturnType<typeof makeCtx>['registerCalls']): Promise<HTMLDivElement> {
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

  it('apply：注册词典 + 经 slots.inject 等待 settings.section 声明', () => {
    const { ctx } = makeCtx()
    bundle.exports.apply(ctx)
    expect(ctx.locale.register).toHaveBeenCalledWith('settings.security', expect.objectContaining({ zh: expect.any(Object), en: expect.any(Object) }))
    expect(ctx.slots.inject).toHaveBeenCalledWith('settings.section', expect.any(Function))
  })

  it('槽位注册：name=settings.section、id=security、label 跟随词典', () => {
    const { ctx, slotFactories, registerCalls } = makeCtx()
    bundle.exports.apply(ctx)
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

  it('remote 贡献经 $mount 挂载（security 命名空间）', () => {
    const { ctx } = makeCtx()
    bundle.exports.apply(ctx)
    expect(ctx.remote.$mount).toHaveBeenCalled()
    const contribution = (ctx.remote.$mount.mock.calls[0]?.[0]) as { namespace?: string }
    expect(contribution?.namespace).toBe('security')
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
