/**
 * 设置存储：双源合并 + 内存缓存 + 原子写。
 *
 * 与框架无关的纯逻辑模块。安全特性：
 * - mergeSettings 逐字段合并（user > preset > fallback——审计 D-M1-8/S3）；
 * - 内存缓存（构造时异步加载；加载完成前 read 回退 preset/fallback）；
 * - write 走 read-modify-merge-write（先同步读磁盘再合并，防初始化竞态）。
 *
 * 数据路径：<root>/settings.json（plugin-data）。
 */

import type { SecuritySettings } from '../contracts/settings'
import { DEFAULT_SETTINGS, validateSettings, type SettingsValidation } from '../contracts/settings'
import { atomicWrite, type PluginDataFs } from './plugin-data'
import { join } from 'node:path'

const SETTINGS_FILE = 'settings.json'

/**
 * 逐字段合并：user 字段 > preset 字段 > fallback。
 * @param preset - 部署方预设（config.defaultSettings，可能 undefined）。
 * @param user - 用户设置（settings.json，可能 undefined）。
 * @param fallback - 代码内标准档。
 * @returns 校验后的完整设置。
 */
export function mergeSettings(
  preset: unknown, user: unknown, fallback: SecuritySettings,
): SettingsValidation {
  // 逐字段取值：user 有则用 user，否则 preset 有则用 preset，否则 fallback。
  const pick = (field: keyof SecuritySettings): unknown => {
    if (typeof user === 'object' && user !== null && field in user) {
      return (user as Record<string, unknown>)[field]
    }
    if (typeof preset === 'object' && preset !== null && field in preset) {
      return (preset as Record<string, unknown>)[field]
    }
    return fallback[field]
  }
  const merged: Record<string, unknown> = {}
  for (const field of Object.keys(fallback) as (keyof SecuritySettings)[]) {
    merged[field] = pick(field)
  }
  return validateSettings(merged)
}

/**
 * 创建设置存储。
 * @param fs - 结构化 fs 切片。
 * @param root - 插件数据根目录。
 * @param preset - 部署方预设（config.defaultSettings）。
 */
export function createSettingsStore(
  fs: PluginDataFs, root: string, preset: unknown,
): {
  read: () => SecuritySettings
  write: (partial: Partial<SecuritySettings>) => Promise<RemoteEnvelopeT<SecuritySettings>>
} {
  const settingsPath = join(root, SETTINGS_FILE)
  /** 内存缓存（异步加载，加载完成前为 fallback）。 */
  let cached: SecuritySettings = (() => {
    const r = mergeSettings(preset, undefined, DEFAULT_SETTINGS)
    return r.ok ? r.settings : DEFAULT_SETTINGS
  })()

  // fire-and-forget 异步加载磁盘到缓存。
  void fs.readFile(settingsPath)
    .then(raw => {
      const user = JSON.parse(raw)
      const r = mergeSettings(preset, user, DEFAULT_SETTINGS)
      if (r.ok) {
        cached = r.settings
      }
    })
    .catch(() => {
      // 文件不存在或损坏 → 保持 fallback 缓存。
    })

  function read(): SecuritySettings {
    return cached
  }

  async function write(partial: Partial<SecuritySettings>): Promise<RemoteEnvelopeT<SecuritySettings>> {
    // 先同步读磁盘（防初始化竞态——内存缓存可能未加载完成）。
    let existing: unknown = undefined
    try {
      existing = JSON.parse(await fs.readFile(settingsPath))
    } catch {
      // 文件不存在 → existing 保持 undefined。
    }
    // 合并：existing（磁盘 user） + partial（本次写入） → 新 user。
    // Object.create(null) 防原型污染（审计 V15）。
    const mergedUser: Record<string, unknown> = Object.create(null)
    if (typeof existing === 'object' && existing !== null) {
      for (const key of Object.keys(existing)) {
        if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
          mergedUser[key] = (existing as Record<string, unknown>)[key]
        }
      }
    }
    for (const key of Object.keys(partial)) {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
        mergedUser[key] = (partial as Record<string, unknown>)[key]
      }
    }
    // 再与 preset + fallback 合并 + 校验。
    const r = mergeSettings(preset, mergedUser, DEFAULT_SETTINGS)
    if (!r.ok) {
      return { ok: false, error: { code: 'invalid-settings', message: `${r.field}: ${r.message}` } }
    }
    // 原子写 user 设置（仅 user 层，不含 preset/fallback）。
    await atomicWrite(fs, root, SETTINGS_FILE, JSON.stringify(mergedUser, null, 2))
    cached = r.settings
    return { ok: true, value: r.settings }
  }

  return { read, write }
}

/** RPC 信封（避免从 contracts/host-endpoints 引入循环依赖）。 */
type RemoteEnvelopeT<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } }
