/**
 * settings-store 纯函数单测。
 *
 * 覆盖：mergeSettings 逐字段优先级 + 内存缓存 + write 部分覆盖 +
 * 写入后 read 反映变更 + 非法字段拒绝 + 加载前 read 回退。
 */
import { describe, expect, it } from 'vitest'
import { mergeSettings, createSettingsStore } from '../src/host/settings-store'
import { DEFAULT_SETTINGS } from '../src/contracts/settings'
import type { SecuritySettings } from '../src/contracts/settings'
import type { PluginDataFs } from '../src/host/plugin-data'

function createMemFs(): PluginDataFs & { files: Map<string, string> } {
  const files = new Map<string, string>()
  return {
    files,
    mkdir: async () => {},
    writeFile: async (path, data) => { files.set(path, data) },
    rename: async (from, to) => { files.set(to, files.get(from) ?? ''); files.delete(from) },
    readFile: async (path) => { const v = files.get(path); if (v === undefined) throw new Error('ENOENT'); return v },
  }
}

describe('mergeSettings', () => {
  it('全部缺省回退 fallback', () => {
    const r = mergeSettings(undefined, undefined, DEFAULT_SETTINGS)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.settings).toEqual(DEFAULT_SETTINGS)
  })

  it('user 优先于 preset 优先于 fallback', () => {
    const preset: Partial<SecuritySettings> = { passwordLogin: false, sessionTtlMinutes: 60 }
    const user: Partial<SecuritySettings> = { passwordLogin: true }
    const r = mergeSettings(preset, user, DEFAULT_SETTINGS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.passwordLogin).toBe(true)       // user 胜
      expect(r.settings.sessionTtlMinutes).toBe(60)     // preset 胜
      expect(r.settings.auditEnabled).toBe(true)        // fallback 胜
    }
  })

  it('user 部分覆盖不丢 preset 字段', () => {
    const preset: Partial<SecuritySettings> = { maxLoginAttempts: 3 }
    const user: Partial<SecuritySettings> = { auditEnabled: false }
    const r = mergeSettings(preset, user, DEFAULT_SETTINGS)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.settings.maxLoginAttempts).toBe(3)   // preset
      expect(r.settings.auditEnabled).toBe(false)   // user
      expect(r.settings.passwordLogin).toBe(true)  // fallback
    }
  })

  it('非法字段拒绝', () => {
    const user = { ...DEFAULT_SETTINGS, sessionTtlMinutes: 1 } // 低于 min=5
    const r = mergeSettings(undefined, user, DEFAULT_SETTINGS)
    expect(r.ok).toBe(false)
  })
})

describe('createSettingsStore', () => {
  it('read 加载前回退 preset/fallback', () => {
    const fs = createMemFs()
    const preset = { passwordLogin: false }
    const store = createSettingsStore(fs, '/root', preset)
    // 同步 read（加载未完成）→ preset 胜
    expect(store.read().passwordLogin).toBe(false)
    expect(store.read().auditEnabled).toBe(true) // fallback
  })

  it('write 部分覆盖后 read 反映变更', async () => {
    const fs = createMemFs()
    const store = createSettingsStore(fs, '/root', undefined)
    const result = await store.write({ auditEnabled: false })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.auditEnabled).toBe(false)
    }
    expect(store.read().auditEnabled).toBe(false)
    expect(store.read().passwordLogin).toBe(true) // fallback 保留
  })

  it('write 非法字段拒绝', async () => {
    const fs = createMemFs()
    const store = createSettingsStore(fs, '/root', undefined)
    const result = await store.write({ sessionTtlMinutes: 1 } as Partial<SecuritySettings>)
    expect(result.ok).toBe(false)
  })

  it('write 不覆盖已存在字段', async () => {
    const fs = createMemFs()
    // 预置一个 settings.json
    fs.files.set('/root/settings.json', JSON.stringify({ maxLoginAttempts: 3 }))
    const store = createSettingsStore(fs, '/root', undefined)
    // 等 fire-and-forget 加载（需要 microtask）
    await new Promise(r => setTimeout(r, 10))
    const result = await store.write({ auditEnabled: false })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.maxLoginAttempts).toBe(3)     // 保留
      expect(result.value.auditEnabled).toBe(false)      // 新写入
    }
  })
})
