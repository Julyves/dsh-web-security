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
      Input: primStub('input'),
      Pill: primStub('span'),
      DisclosureRow: primStub('div'),
      RiskConfirmation: primStub('div'),
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
const ZH = {
  page: '安全',
  bannerTitle: '部署警告',
  statusLoadFailed: '状态加载失败',
  accountsTitle: '账号管理',
  passkeyTitle: '通行密钥',
  policyTitle: '安全策略',
  auditTitle: '审计日志',
}

/** 构造 stub client ctx。 */
function makeCtx(overrides: { remoteSecurity?: Record<string, unknown> } = {}) {
  const slotFactories = new Map<string, () => unknown>()
  const registerCalls: { options: { name: string; id?: string; order?: number; inject?: () => Record<string, unknown> }; component: unknown }[] = []
  const ctx = {
    effect: vi.fn((cb: () => unknown) => { const d = cb(); return typeof d === 'function' ? d : undefined }),
    locale: {
      register: vi.fn(() => () => {}),
      bind: vi.fn((ns: string) => (key: string) => (ns === 'settings.security' ? ZH[key as keyof typeof ZH] ?? key : key)),
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
      security: overrides.remoteSecurity ?? {},
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
