// @vitest-environment node
/**
 * SecurityService 装配层测试：status.diagnostics 真实填充（M4）。
 *
 * 规格：.scratch/m4-settings-ui/spec.md User Story 2a / 缺口 2。
 * 宿主 webServer 绑定非 loopback 时，status() 必须携带警告；loopback 与
 * 服务未提供时分别为空（后者为降级，不崩溃）。
 *
 * 经构建产物 lib/host/index.js 测装配层（与 tests/smoke-host.mjs 同惯例：
 * vitest 的 esbuild 转换不支持 src/host/index.ts 的装饰器语法）。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SecurityService } from '../src/host/index'

/** 构造 stub ctx（面与 tests/smoke-host.mjs 一致）。 */
function makeCtx(webServer: { host: '127.0.0.1' | '0.0.0.0'; port: number } | undefined): Context {
  const ctx = {
    root: undefined,
    reflect: { props: {}, provide() {} },
    get: (key: string) => (key === 'webServer' ? webServer : undefined),
    inject: (_keys: readonly string[], cb: (c: Context) => void) => { cb(ctx as Context) },
    effect: () => {},
    on: () => () => {},
    plugin: () => Promise.resolve(),
    logger: { warn() {}, info() {}, error() {} },
  } as unknown as Context
  return ctx
}

/** 经构建产物构造服务（enabled=false 不监听；临时 plugin-data 目录）。 */
async function makeService(webServer: { host: '127.0.0.1' | '0.0.0.0'; port: number } | undefined): Promise<{ svc: SecurityService; cleanup: () => Promise<void> }> {
  const { default: SecurityServiceCtor } = await import(join(process.cwd(), 'lib/host/index.js'))
  const tmp = await mkdtemp(join(tmpdir(), 'dsh-web-sec-diag-'))
  const svc = new SecurityServiceCtor(makeCtx(webServer), {
    enabled: false,
    entry: { host: '0.0.0.0', port: 3443, tls: { certPath: null, keyPath: null }, tlsMode: 'http' },
    upstream: { host: '127.0.0.1', port: 3080 },
    session: { ttlMinutes: 480 },
    rateLimit: { maxAttempts: 5, windowMinutes: 15 },
    dshHome: tmp,
    rpID: '',
  }) as SecurityService
  return { svc, cleanup: () => rm(tmp, { recursive: true, force: true }) }
}

describe('status.diagnostics 填充（M4）', () => {
  it('webServer 绑定 0.0.0.0 → 警告 LAN 绕过风险', async () => {
    const { svc, cleanup } = await makeService({ host: '0.0.0.0', port: 3080 })
    try {
      const status = await svc.status({})
      expect(status.diagnostics.length).toBeGreaterThanOrEqual(1)
      expect(status.diagnostics[0]).toContain('0.0.0.0')
      expect(status.diagnostics[0]).toContain('3080')
    } finally { await cleanup() }
  })

  it('webServer 绑定 127.0.0.1 → diagnostics 为空', async () => {
    const { svc, cleanup } = await makeService({ host: '127.0.0.1', port: 3080 })
    try {
      const status = await svc.status({})
      expect(status.diagnostics).toEqual([])
    } finally { await cleanup() }
  })

  it('webServer 未提供（get 返回 undefined）→ 降级为空不崩溃', async () => {
    const { svc, cleanup } = await makeService(undefined)
    try {
      const status = await svc.status({})
      expect(status.diagnostics).toEqual([])
    } finally { await cleanup() }
  })
})
