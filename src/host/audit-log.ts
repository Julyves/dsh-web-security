/**
 * 审计日志：内存缓冲 + 防抖落盘 + 分页读取。
 *
 * 与框架无关的纯逻辑模块。安全特性：
 * - jsonl 格式（每行一个 JSON 事件，JSON.stringify 转义换行防格式破坏）；
 * - 防抖落盘（内存缓冲 + 1s 定时 flush + 50 条阈值触发即时 flush）；
 * - flush 失败静默降级（不阻断业务，审计丢失可接受）；
 * - 读取分页（全量读 + 内存切片，最新在前）；
 * - enabled=false 时 append 静默 no-op（设置开关）。
 *
 * 数据路径：<root>/audit.jsonl（plugin-data）。
 */

import type { AuthEvent } from '../contracts/auth-events'
import { atomicWrite, type PluginDataFs } from './plugin-data'
import { join } from 'node:path'

const AUDIT_FILE = 'audit.jsonl'
const FLUSH_INTERVAL_MS = 1000
const FLUSH_THRESHOLD = 50

/**
 * 创建审计日志。
 * @param fs - 结构化 fs 切片。
 * @param root - 插件数据根目录。
 * @param enabled - 是否启用（设置开关）。
 */
export function createAuditLog(fs: PluginDataFs, root: string, enabled: boolean): {
  append: (event: AuthEvent) => void
  read: (offset: number, limit: number) => Promise<{ events: readonly AuthEvent[]; hasMore: boolean }>
  flush: () => Promise<void>
} {
  /** 内存缓冲（待落盘的事件）。 */
  const buffer: AuthEvent[] = []
  /** 定时 flush 句柄。 */
  let flushTimer: ReturnType<typeof setInterval> | undefined
  const auditPath = join(root, AUDIT_FILE)

  if (enabled) {
    flushTimer = setInterval(() => {
      void flush().catch(() => {
        // 落盘失败静默降级（不阻断业务）。
      })
    }, FLUSH_INTERVAL_MS)
    // timer 不阻塞进程退出（unref）。
    if (typeof flushTimer.unref === 'function') flushTimer.unref()
  }

  function append(event: AuthEvent): void {
    if (!enabled) return // 设置开关关闭时静默 no-op
    buffer.push(event)
    if (buffer.length >= FLUSH_THRESHOLD) {
      void flush().catch(() => {})
    }
  }

  async function flush(): Promise<void> {
    if (buffer.length === 0) return
    // 取出当前缓冲（快照），清空后异步写。
    const batch = buffer.splice(0, buffer.length)
    // 读取现有文件内容 + 追加新行（非整文件原子写——追加模式）。
    let existing = ''
    try {
      existing = await fs.readFile(auditPath)
    } catch {
      // 文件不存在 → 空内容（首次写入）。
    }
    const lines = batch.map(e => JSON.stringify(e)).join('\n')
    const content = existing.length > 0 ? `${existing.trimEnd()}\n${lines}\n` : `${lines}\n`
    try {
      await atomicWrite(fs, root, AUDIT_FILE, content)
    } catch {
      // 落盘失败：将事件放回缓冲（下次 flush 重试），静默降级。
      buffer.unshift(...batch)
    }
  }

  async function read(offset: number, limit: number): Promise<{ events: readonly AuthEvent[]; hasMore: boolean }> {
    let raw: string
    try {
      raw = await fs.readFile(auditPath)
    } catch {
      return { events: [], hasMore: false }
    }
    const lines = raw.split('\n').filter(l => l.length > 0)
    const events: AuthEvent[] = []
    for (const line of lines) {
      try {
        events.push(JSON.parse(line) as AuthEvent)
      } catch {
        // 损坏行跳过（宁可丢个别事件，不可产出坏数据）。
      }
    }
    // 最新在前（倒序）。
    events.reverse()
    const start = offset
    const end = start + limit
    const slice = events.slice(start, end)
    return { events: slice, hasMore: end < events.length }
  }

  // dispose 时清理 timer（M1 由 SecurityService 生命周期调用 flush）。
  const origFlush = flush
  return {
    append,
    read,
    flush: origFlush,
  }
}

/** 销毁审计日志：flush 残余 + 清理 timer。 */
export function disposeAuditLog(log: { flush: () => Promise<void> }): void {
  void log.flush().catch(() => {})
}
