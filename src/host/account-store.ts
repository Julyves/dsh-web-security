/**
 * 账号存储：scrypt 密码哈希 + CRUD + 假校验防用户名枚举。
 *
 * 与框架无关的纯逻辑模块。安全特性（审计 S3/M4/M5）：
 * - scrypt 哈希（node:crypto.scryptSync，零依赖）+ 每用户随机 salt；
 * - 假校验（用户名不存在时执行 dummy scrypt，保持响应时间一致——防枚举）；
 * - 密码强度校验（最小 12 字符 + 1 数字 + 1 符号）；
 * - 用户名字符集（/^[a-zA-Z0-9_-]{1,64}$/，防存储型 XSS）；
 * - 恒定时间比较（crypto.timingSafeEqual）。
 *
 * 数据结构见 docs/m1-implementation-plan.md D-M1-4。
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import type { AccountSummary } from '../contracts/host-endpoints'
import { atomicWrite, type PluginDataFs } from './plugin-data'
import { join } from 'node:path'

const ACCOUNTS_FILE = 'accounts.json'

/** scrypt 参数（OWASP 2023 推荐）。 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 }

/** 用户名允许字符集与长度。 */
const USERNAME_RE = /^[a-zA-Z0-9_-]{1,64}$/

/** 密码最小长度。 */
const MIN_PASSWORD_LEN = 12
/** 密码最大长度（字节）。 */
const MAX_PASSWORD_BYTES = 1024

/** 假校验用固定 salt + 哈希（防用户名枚举——审计 S3）。 */
const DUMMY_SALT = randomBytes(16)
const DUMMY_HASH = scryptSync('dummy-password', DUMMY_SALT, SCRYPT_PARAMS.keyLen, SCRYPT_PARAMS)

/** 一条 passkey 凭证位（M3 填充）。 */
export interface PasskeyCredential {
  readonly credentialId: string
  readonly publicKey: string
  readonly counter: number
  readonly transports: readonly string[]
}

/** 一条账号完整记录（含哈希/盐——host 内部用）。 */
export interface AccountRecord {
  readonly username: string
  readonly passwordHash: string
  readonly salt: string
  readonly scryptParams: { N: number; r: number; p: number; keyLen: number }
  readonly passkeys: readonly PasskeyCredential[]
  readonly createdAt: number
  readonly updatedAt: number
}

/** 账号文件整体结构。 */
interface AccountsFile {
  readonly v: number
  readonly accounts: readonly AccountRecord[]
}

/** 校验用户名字符集。 */
export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username)
}

/** 校验密码强度（最小 12 字符 + 1 数字 + 1 符号——审计 M4）。 */
export function validatePasswordStrength(password: string): { ok: true } | { ok: false; message: string } {
  if (password.length < MIN_PASSWORD_LEN) {
    return { ok: false, message: `密码至少 ${MIN_PASSWORD_LEN} 字符` }
  }
  if (Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
    return { ok: false, message: '密码过长' }
  }
  if (!/\d/.test(password)) {
    return { ok: false, message: '密码必须包含至少 1 个数字' }
  }
  if (!/[^a-zA-Z0-9]/.test(password)) {
    return { ok: false, message: '密码必须包含至少 1 个符号' }
  }
  return { ok: true }
}

/** 从完整记录提取摘要（绝不含哈希/盐）。 */
function toSummary(record: AccountRecord): AccountSummary {
  return {
    username: record.username,
    hasPasskey: record.passkeys.length > 0,
    createdAt: record.createdAt,
  }
}

/**
 * 创建账号存储。
 * @param fs - 结构化 fs 切片。
 * @param root - 插件数据根目录。
 */
export function createAccountStore(fs: PluginDataFs, root: string): {
  list: () => Promise<readonly AccountSummary[]>
  find: (username: string) => Promise<AccountRecord | undefined>
  verifyPassword: (username: string, password: string) => Promise<boolean>
  create: (username: string, password: string) => Promise<void>
  updatePassword: (username: string, current: string, next: string) => Promise<void>
  remove: (username: string) => Promise<void>
  hasAny: () => Promise<boolean>
  // passkey CRUD（M3）
  addPasskey: (username: string, credential: PasskeyCredential) => Promise<void>
  listPasskeys: (username: string) => Promise<readonly PasskeyCredential[]>
  findPasskey: (credentialId: string) => Promise<{ username: string; credential: PasskeyCredential } | undefined>
  updatePasskeyCounter: (credentialId: string, counter: number) => Promise<void>
  removePasskey: (username: string, credentialId: string) => Promise<void>
} {
  const accountsPath = join(root, ACCOUNTS_FILE)

  async function read(): Promise<AccountsFile> {
    try {
      const raw = await fs.readFile(accountsPath)
      return JSON.parse(raw) as AccountsFile
    } catch {
      return { v: 1, accounts: [] }
    }
  }

  async function write(file: AccountsFile): Promise<void> {
    await atomicWrite(fs, root, ACCOUNTS_FILE, JSON.stringify(file, null, 2))
  }

  async function list(): Promise<readonly AccountSummary[]> {
    const file = await read()
    return file.accounts.map(toSummary)
  }

  async function find(username: string): Promise<AccountRecord | undefined> {
    const file = await read()
    return file.accounts.find(a => a.username === username)
  }

  /**
   * 校验密码（含假校验防枚举——审计 S3）。
   * 用户名不存在时执行 dummy scrypt，保持与真实校验相同的响应时间。
   */
  async function verifyPassword(username: string, password: string): Promise<boolean> {
    const record = await find(username)
    if (record === undefined) {
      // 假校验：执行一次真实 scrypt（用 DUMMY_SALT），结果丢弃但耗时一致。
      scryptSync(password, DUMMY_SALT, SCRYPT_PARAMS.keyLen, SCRYPT_PARAMS)
      timingSafeEqual(DUMMY_HASH, DUMMY_HASH) // 恒 true，丢弃
      return false
    }
    const hash = scryptSync(password, Buffer.from(record.salt, 'hex'), record.scryptParams.keyLen, record.scryptParams)
    return timingSafeEqual(hash, Buffer.from(record.passwordHash, 'hex'))
  }

  async function create(username: string, password: string): Promise<void> {
    if (!isValidUsername(username)) {
      throw new Error('web-security: 用户名必须匹配 /^[a-zA-Z0-9_-]{1,64}$/（审计 M5）')
    }
    const strength = validatePasswordStrength(password)
    if (!strength.ok) {
      throw new Error(`web-security: ${strength.message}（审计 M4）`)
    }
    const file = await read()
    if (file.accounts.some(a => a.username === username)) {
      throw new Error(`web-security: 用户名 ${JSON.stringify(username)} 已存在`)
    }
    const salt = randomBytes(16)
    const hash = scryptSync(password, salt, SCRYPT_PARAMS.keyLen, SCRYPT_PARAMS)
    const now = Date.now()
    const record: AccountRecord = {
      username,
      passwordHash: hash.toString('hex'),
      salt: salt.toString('hex'),
      scryptParams: { ...SCRYPT_PARAMS },
      passkeys: [],
      createdAt: now,
      updatedAt: now,
    }
    await write({ v: 1, accounts: [...file.accounts, record] })
  }

  async function updatePassword(username: string, current: string, next: string): Promise<void> {
    const valid = await verifyPassword(username, current)
    if (!valid) {
      throw new Error('web-security: 当前密码不正确')
    }
    const strength = validatePasswordStrength(next)
    if (!strength.ok) {
      throw new Error(`web-security: ${strength.message}（审计 M4）`)
    }
    const file = await read()
    const accounts = file.accounts.map(a => {
      if (a.username !== username) return a
      const salt = randomBytes(16)
      const hash = scryptSync(next, salt, SCRYPT_PARAMS.keyLen, SCRYPT_PARAMS)
      return { ...a, passwordHash: hash.toString('hex'), salt: salt.toString('hex'), updatedAt: Date.now() }
    })
    await write({ v: 1, accounts })
  }

  async function remove(username: string): Promise<void> {
    const file = await read()
    const accounts = file.accounts.filter(a => a.username !== username)
    if (accounts.length === file.accounts.length) {
      throw new Error(`web-security: 用户名 ${JSON.stringify(username)} 不存在`)
    }
    await write({ v: 1, accounts })
  }

  async function hasAny(): Promise<boolean> {
    const file = await read()
    return file.accounts.length > 0
  }

  // ── passkey CRUD（M3）──

  async function addPasskey(username: string, credential: PasskeyCredential): Promise<void> {
    const file = await read()
    const accounts = file.accounts.map(a => {
      if (a.username !== username) return a
      // 同一 credentialId 不重复注册。
      const exists = a.passkeys.some(p => p.credentialId === credential.credentialId)
      if (exists) throw new Error(`web-security: passkey ${credential.credentialId.slice(0, 8)} 已注册`)
      return { ...a, passkeys: [...a.passkeys, credential], updatedAt: Date.now() }
    })
    if (accounts.length === file.accounts.length && !file.accounts.some(a => a.username === username)) {
      throw new Error(`web-security: 用户名 ${JSON.stringify(username)} 不存在`)
    }
    await write({ v: 1, accounts })
  }

  async function listPasskeys(username: string): Promise<readonly PasskeyCredential[]> {
    const record = await find(username)
    return record?.passkeys ?? []
  }

  async function findPasskey(credentialId: string): Promise<{ username: string; credential: PasskeyCredential } | undefined> {
    const file = await read()
    for (const account of file.accounts) {
      const cred = account.passkeys.find(p => p.credentialId === credentialId)
      if (cred !== undefined) return { username: account.username, credential: cred }
    }
    return undefined
  }

  async function updatePasskeyCounter(credentialId: string, counter: number): Promise<void> {
    const file = await read()
    const accounts = file.accounts.map(a => ({
      ...a,
      passkeys: a.passkeys.map(p => p.credentialId === credentialId ? { ...p, counter } : p),
    }))
    await write({ v: 1, accounts })
  }

  async function removePasskey(username: string, credentialId: string): Promise<void> {
    const file = await read()
    const accounts = file.accounts.map(a => {
      if (a.username !== username) return a
      return { ...a, passkeys: a.passkeys.filter(p => p.credentialId !== credentialId), updatedAt: Date.now() }
    })
    await write({ v: 1, accounts })
  }

  return { list, find, verifyPassword, create, updatePassword, remove, hasAny,
    addPasskey, listPasskeys, findPasskey, updatePasskeyCounter, removePasskey }
}
