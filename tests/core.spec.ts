/**
 * normalizeConfig 纯函数单测（无宿主依赖）。
 *
 * 覆盖：默认值兜底、非法字段大声失败、TLS 证书成对校验、区间钳制拒绝。
 */
import { describe, expect, it } from 'vitest'
import { normalizeConfig, DEFAULT_CONFIG } from '../src/host/core'

describe('normalizeConfig', () => {
  it('空输入回退出厂默认配置', () => {
    const config = normalizeConfig(undefined)
    expect(config).toEqual({ ...DEFAULT_CONFIG, defaultSettings: undefined })
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