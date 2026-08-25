/**
 * 纯函数单测（无宿主依赖）：normalizeConfig 与 validateSettings。
 *
 * 覆盖：默认值兜底、缺省即默认档语义、非法字段大声失败、
 * TLS 证书成对校验、区间钳制拒绝。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { normalizeConfig, DEFAULT_CONFIG } from '../src/host/core'
import { validateSettings, DEFAULT_SETTINGS } from '../src/contracts/settings'

/** 测试内复现 core.ts 的 home 兜底期望值（$DSH_HOME 未设置时）。 */
const expectedDefaultHome = (): string => join(homedir(), '.dsh')

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('normalizeConfig', () => {
  it('空输入回退出厂默认配置，且 dshHome 被真实解析', () => {
    // 回归守护：undefined 输入与 {} 必须同路——dshHome 等运行时解析
    // 字段不允许泄漏 DEFAULT_CONFIG 的空串占位。
    const config = normalizeConfig(undefined)
    expect(config.enabled).toBe(DEFAULT_CONFIG.enabled)
    expect(config.entry).toEqual(DEFAULT_CONFIG.entry)
    expect(config.dshHome).toBe(expectedDefaultHome())
  })

  it('合法字段透传并保持原值', () => {
    const config = normalizeConfig({
      enabled: false,
      entry: { host: '127.0.0.1', port: 8443 },
      session: { ttlMinutes: 120 },
      rateLimit: { maxAttempts: 3, windowMinutes: 10 },
    })
    expect(config.enabled).toBe(false)
    expect(config.entry.host).toBe('127.0.0.1')
    expect(config.entry.port).toBe(8443)
    expect(config.session.ttlMinutes).toBe(120)
    expect(config.rateLimit.maxAttempts).toBe(3)
  })

  it('dshHome 解析优先级：config 显式值 → $DSH_HOME → ~/.dsh（空串视为未设置）', () => {
    expect(normalizeConfig({ dshHome: '/data/dsh-home' }).dshHome).toBe('/data/dsh-home')
    vi.stubEnv('DSH_HOME', '/env/dsh-home')
    expect(normalizeConfig({}).dshHome).toBe('/env/dsh-home')
    expect(normalizeConfig({ dshHome: '/data/dsh-home' }).dshHome).toBe('/data/dsh-home')
    vi.stubEnv('DSH_HOME', '')
    expect(normalizeConfig({}).dshHome).toBe(expectedDefaultHome())
  })

  it('非法 entry.host 大声失败', () => {
    expect(() => normalizeConfig({ entry: { host: '0.0.0.1' } })).toThrow(/entry\.host/)
  })

  it('端口越界大声失败', () => {
    expect(() => normalizeConfig({ entry: { port: 70000 } })).toThrow(/entry\.port/)
    expect(() => normalizeConfig({ entry: { port: 0 } })).toThrow(/entry\.port/)
  })

  it('TLS 证书必须成对提供', () => {
    expect(() => normalizeConfig({ entry: { tls: { certPath: '/a.pem', keyPath: null } } }))
      .toThrow(/同时提供或同时为 null/)
    expect(() => normalizeConfig({ entry: { tls: { certPath: '/a.pem', keyPath: '/b.key' } } }))
      .not.toThrow()
  })

  it('enabled 必须是布尔值', () => {
    expect(() => normalizeConfig({ enabled: 'yes' })).toThrow(/enabled/)
  })

  it('defaultSettings 原样保留供上层校验', () => {
    const preset = { passwordLogin: false }
    const config = normalizeConfig({ defaultSettings: preset })
    expect(config.defaultSettings).toEqual(preset)
  })
})

describe('validateSettings', () => {
  it('未配置（undefined/null）回退出厂标准档——绝不能报错', () => {
    // 回归守护：defaultSettings 未配置是部署常态，settingsRead 必须可用。
    expect(validateSettings(undefined)).toEqual({ ok: true, settings: DEFAULT_SETTINGS })
    expect(validateSettings(null)).toEqual({ ok: true, settings: DEFAULT_SETTINGS })
  })

  it('完整合法设置透传', () => {
    const settings = {
      passwordLogin: true,
      passkeyLogin: false,
      sessionTtlMinutes: 60,
      maxLoginAttempts: 3,
      rateLimitWindowMinutes: 10,
      auditEnabled: true,
    }
    expect(validateSettings(settings)).toEqual({ ok: true, settings })
  })

  it('非法类型逐字段拒绝', () => {
    expect(validateSettings({ ...DEFAULT_SETTINGS, passwordLogin: 'yes' }).ok).toBe(false)
    expect(validateSettings({ ...DEFAULT_SETTINGS, sessionTtlMinutes: 1 }).ok).toBe(false)
    expect(validateSettings({ ...DEFAULT_SETTINGS, maxLoginAttempts: 0 }).ok).toBe(false)
    expect(validateSettings({ ...DEFAULT_SETTINGS, auditEnabled: null }).ok).toBe(false)
  })

  it('缺少字段拒绝（全量校验语义；部分合并由 M1 的 mergeSettings 承担）', () => {
    const partial = { passwordLogin: true }
    const result = validateSettings(partial)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.field).toBe('passkeyLogin')
  })

  it('非对象输入拒绝', () => {
    expect(validateSettings('settings').ok).toBe(false)
    expect(validateSettings([1]).ok).toBe(false)
  })
})