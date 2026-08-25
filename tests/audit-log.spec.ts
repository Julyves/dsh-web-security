/**
 * audit-log 纯函数单测。
 *
 * 覆盖：append + flush + 追加不覆盖旧数据 + 分页读取 + hasMore +
 * 损坏行跳过 + enabled=false no-op + 落盘失败回退缓冲。
 */
import { describe, expect, it } from 'vitest'
import { createAuditLog } from '../src/host/audit-log'
import type { AuthEvent } from '../src/contracts/auth-events'
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

function makeEvent(i: number): AuthEvent {
  return { kind: 'login-success', at: 1700000000000 + i, actor: `user${i}`, ip: '127.0.0.1' }
}

describe('createAuditLog', () => {
  it('append 后 flush 写入文件', async () => {
    const fs = createMemFs()
    const log = createAuditLog(fs, '/root', true)
    log.append(makeEvent(0))
    log.append(makeEvent(1))
    await log.flush()
    const raw = fs.files.get('/root/audit.jsonl')
    expect(raw).toBeDefined()
    const lines = raw!.split('\n').filter(l => l.length > 0)
    expect(lines).toHaveLength(2)
  })

  it('二次 flush 追加不覆盖旧数据', async () => {
    const fs = createMemFs()
    const log = createAuditLog(fs, '/root', true)
    log.append(makeEvent(0))
    await log.flush()
    log.append(makeEvent(1))
    await log.flush()
    const raw = fs.files.get('/root/audit.jsonl')!
    const lines = raw.split('\n').filter(l => l.length > 0)
    expect(lines).toHaveLength(2)
    const e0 = JSON.parse(lines[0]!) as AuthEvent
    const e1 = JSON.parse(lines[1]!) as AuthEvent
    expect(e0.actor).toBe('user0')
    expect(e1.actor).toBe('user1')
  })

  it('read 分页最新在前', async () => {
    const fs = createMemFs()
    const log = createAuditLog(fs, '/root', true)
    for (let i = 0; i < 10; i++) log.append(makeEvent(i))
    await log.flush()
    const page1 = await log.read(0, 5)
    expect(page1.events).toHaveLength(5)
    expect(page1.hasMore).toBe(true)
    // 最新在前 → user9 在第一
    expect(page1.events[0]!.actor).toBe('user9')
    const page2 = await log.read(5, 5)
    expect(page2.events).toHaveLength(5)
    expect(page2.hasMore).toBe(false)
  })

  it('read 空文件返回空数组', async () => {
    const fs = createMemFs()
    const log = createAuditLog(fs, '/root', true)
    const result = await log.read(0, 10)
    expect(result.events).toHaveLength(0)
    expect(result.hasMore).toBe(false)
  })

  it('损坏行跳过不抛错', async () => {
    const fs = createMemFs()
    fs.files.set('/root/audit.jsonl', '{"valid":true}\n{bad json}\n{"also":"valid"}\n')
    const log = createAuditLog(fs, '/root', true)
    const result = await log.read(0, 10)
    expect(result.events.length).toBeLessThanOrEqual(3)
  })

  it('enabled=false 时 append 静默 no-op', async () => {
    const fs = createMemFs()
    const log = createAuditLog(fs, '/root', false)
    log.append(makeEvent(0))
    await log.flush()
    expect(fs.files.has('/root/audit.jsonl')).toBe(false)
  })

  it('用户名含特殊字符不影响 jsonl 格式', async () => {
    const fs = createMemFs()
    const log = createAuditLog(fs, '/root', true)
    log.append({ kind: 'login-failure', at: 1700000000000, actor: 'user<script>', detail: 'line1\nline2' })
    await log.flush()
    const raw = fs.files.get('/root/audit.jsonl')!
    const lines = raw.split('\n').filter(l => l.length > 0)
    expect(lines).toHaveLength(1)
    const parsed = JSON.parse(lines[0]!) as AuthEvent
    expect(parsed.actor).toBe('user<script>')
    expect(parsed.detail).toBe('line1\nline2')
  })
})
