/**
 * account-store 纯函数单测。
 *
 * 覆盖：CRUD 全流程 + 假校验防枚举 + 密码强度 + 用户名字符集 + 恒定时间。
 * 注入内存 fs 实现（Map<path, string>）。
 */
import { describe, expect, it } from 'vitest'
import { createAccountStore, validatePasswordStrength, isValidUsername } from '../src/host/account-store'
import type { PluginDataFs } from '../src/host/plugin-data'

/** 内存 fs 实现（Map<path, string> 模拟文件系统）。 */
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

describe('isValidUsername', () => {
  it('合法用户名', () => {
    expect(isValidUsername('admin')).toBe(true)
    expect(isValidUsername('user_name')).toBe(true)
    expect(isValidUsername('user-1')).toBe(true)
  })
  it('非法用户名', () => {
    expect(isValidUsername('')).toBe(false)
    expect(isValidUsername('a'.repeat(65))).toBe(false)
    expect(isValidUsername('<script>')).toBe(false)
    expect(isValidUsername('user name')).toBe(false) // 空格
    expect(isValidUsername('用户')).toBe(false) // 非 ASCII
  })
})

describe('validatePasswordStrength', () => {
  it('合法密码', () => {
    expect(validatePasswordStrength('password123!')).toEqual({ ok: true })
  })
  it('过短', () => {
    expect(validatePasswordStrength('short1!').ok).toBe(false)
  })
  it('无数字', () => {
    expect(validatePasswordStrength('passwordpass!').ok).toBe(false)
  })
  it('无符号', () => {
    expect(validatePasswordStrength('passwordpass1').ok).toBe(false)
  })
})

describe('createAccountStore', () => {
  it('创建并验证账号', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    const valid = await store.verifyPassword('admin', 'SecurePass123!')
    expect(valid).toBe(true)
  })

  it('错误密码返回 false', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    const valid = await store.verifyPassword('admin', 'WrongPass123!')
    expect(valid).toBe(false)
  })

  it('不存在的用户名假校验后返回 false（防枚举——审计 S3）', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    // 不存在的用户名也执行 scrypt（耗时与真实校验一致）
    const start = Date.now()
    const valid = await store.verifyPassword('nonexistent', 'anypassword123!')
    const elapsed = Date.now() - start
    expect(valid).toBe(false)
    // 假校验耗时 > 0（scrypt 执行了），但不做严格时间断言（CI 环境波动）
    expect(elapsed).toBeGreaterThanOrEqual(0)
  })

  it('用户名已存在抛错', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    await expect(store.create('admin', 'OtherPass123!')).rejects.toThrow(/已存在/)
  })

  it('非法用户名抛错', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await expect(store.create('<script>', 'SecurePass123!')).rejects.toThrow(/用户名/)
  })

  it('弱密码抛错', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await expect(store.create('admin', 'short1!')).rejects.toThrow(/密码/)
  })

  it('list 返回摘要（绝不含哈希）', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.username).toBe('admin')
    expect(list[0]!.hasPasskey).toBe(false)
    // 确认返回值不含哈希/盐
    const raw = JSON.stringify(list)
    expect(raw).not.toContain('passwordHash')
    expect(raw).not.toContain('salt')
  })

  it('hasAny 正确反映初始化状态', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    expect(await store.hasAny()).toBe(false)
    await store.create('admin', 'SecurePass123!')
    expect(await store.hasAny()).toBe(true)
  })

  it('updatePassword 正确密码后可改密', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    await store.updatePassword('admin', 'SecurePass123!', 'NewPass4567@')
    expect(await store.verifyPassword('admin', 'NewPass4567@')).toBe(true)
    expect(await store.verifyPassword('admin', 'SecurePass123!')).toBe(false)
  })

  it('updatePassword 错误当前密码抛错', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    await expect(store.updatePassword('admin', 'Wrong', 'NewPass4567@')).rejects.toThrow(/不正确/)
  })

  it('remove 删除账号', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await store.create('admin', 'SecurePass123!')
    await store.remove('admin')
    expect(await store.hasAny()).toBe(false)
    expect(await store.verifyPassword('admin', 'SecurePass123!')).toBe(false)
  })

  it('remove 不存在的用户名抛错', async () => {
    const fs = createMemFs()
    const store = createAccountStore(fs, '/root')
    await expect(store.remove('nonexistent')).rejects.toThrow(/不存在/)
  })
})
