/**
 * 插件数据存储面：`<home>/plugin-data/dsh-web-security/`。
 *
 * home 解析优先级：config.dshHome → $DSH_HOME → ~/.dsh（平台约定）。
 * 平台不提供 storage 服务，插件自持存储：原子写 + 文件名白名单 +
 * 大小上限；落盘失败不阻断业务（结构化注入 `node:fs/promises` 切片，
 * 便于纯函数单测）。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** 插件数据目录名（与包名一致，平台约定隔离）。 */
export const PLUGIN_DATA_DIR = 'dsh-web-security'

/** 可写文件白名单（防路径穿越；新增文件必须先注册）。 */
export const ALLOWED_FILE_NAMES = new Set(['accounts.json', 'settings.json', 'audit.jsonl'])

/** 文件大小上限（字节）：账号/设置 1 MiB，审计 64 MiB。 */
export const MAX_FILE_BYTES: Readonly<Record<string, number>> = {
  'accounts.json': 1024 * 1024,
  'settings.json': 1024 * 1024,
  'audit.jsonl': 64 * 1024 * 1024,
}

/** 结构化 fs 切片（默认接 node:fs/promises，测试注入内存实现）。 */
export interface PluginDataFs {
  /** 递归创建目录；返回首个实际创建的目录路径（与 node 一致）。 */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  writeFile(path: string, data: string, options?: { flag?: string; mode?: number }): Promise<void>
  rename(from: string, to: string): Promise<void>
}

/** 默认 fs 实现（生产路径）。 */
export const nodeFs: PluginDataFs = {
  mkdir: (path, options) => mkdir(path, options),
  writeFile: (path, data, options) => writeFile(path, data, options),
  rename: (from, to) => rename(from, to),
}

/**
 * 解析插件数据根目录。
 * @param dshHome - 配置里的 dshHome（可选）。
 * @returns 插件数据根绝对路径。
 */
export function resolvePluginDataRoot(dshHome: string | undefined): string {
  const home = dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return resolve(home, 'plugin-data', PLUGIN_DATA_DIR)
}

/**
 * 校验文件名是否可写（白名单 + 无路径分隔符）。
 * @param name - 裸文件名。
 * @returns 是否允许。
 */
export function isAllowedFileName(name: string): boolean {
  return ALLOWED_FILE_NAMES.has(name) && !name.includes('/') && !name.includes('\\')
}

/**
 * 原子写：先写临时文件再 rename，避免半截文件被读到。
 * @param fs - 结构化 fs 切片。
 * @param root - 插件数据根目录。
 * @param name - 白名单内文件名。
 * @param content - 写入内容。
 */
export async function atomicWrite(
  fs: PluginDataFs,
  root: string,
  name: string,
  content: string,
): Promise<void> {
  if (!isAllowedFileName(name)) throw new Error(`web-security: 非白名单文件名 ${JSON.stringify(name)}`)
  const maxBytes = MAX_FILE_BYTES[name]
  if (maxBytes !== undefined && Buffer.byteLength(content, 'utf8') > maxBytes) {
    throw new Error(`web-security: 文件 ${name} 超过大小上限`)
  }
  await fs.mkdir(root, { recursive: true })
  const target = join(root, name)
  // 唯一临时名：并发写同一文件时互不覆盖（rename 保证读者只见完整内容）。
  const tmp = `${target}.${randomUUID()}.tmp`
  await fs.writeFile(tmp, content, { flag: 'w', mode: 0o600 })
  await fs.rename(tmp, target)
}