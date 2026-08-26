/**
 * 反向代理转发器：HTTP 请求 + WebSocket upgrade 透明转发到上游宿主。
 *
 * 与框架无关的纯逻辑模块。核心安全特性（蓝图 D4）：
 * - Host/Origin 归一化为上游 loopback 形态（PRIVILEGED_METHODS 钉死 loopback）；
 * - 注入 X-Forwarded-For/Proto/Host 传递真实来源（审计用）；
 * - sec-fetch-site 非 cross-site（浏览器对同站 API 本就不发 cross-site）。
 *
 * HTTP 转发用 node:http.request（流式 body + 响应）。
 * WebSocket upgrade 转发用原始 TCP 隧道（net.connect → 写改写后的请求行+头 → 双向管道）。
 */

import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { pipeline } from 'node:stream'

/** 代理转发所需的上游配置。 */
export interface ProxyUpstream {
  readonly host: string
  readonly port: number
}

/**
 * 创建反向代理转发器。
 * @param upstream - 上游 dsh 宿主地址。
 */
export function createProxy(upstream: ProxyUpstream): {
  /** 转发 HTTP 请求到上游，流式回传响应。 */
  forward: (req: IncomingMessage, res: ServerResponse, clientIp: string) => Promise<void>
  /** 转发 WebSocket upgrade 到上游（原始 TCP 隧道）。 */
  forwardUpgrade: (req: IncomingMessage, socket: Duplex, head: Buffer, clientIp: string) => Promise<void>
} {
  const { host: upstreamHost, port: upstreamPort } = upstream
  const upstreamAuthority = `${upstreamHost}:${upstreamPort}`
  const upstreamOrigin = `http://${upstreamAuthority}`

  /**
   * 改写请求头：归一化 Host/Origin 为上游 loopback 形态 + 注入 X-Forwarded-*。
   */
  function rewriteHeaders(req: IncomingMessage, clientIp: string): Record<string, string> {
    const headers: Record<string, string> = {}
    for (const [key, val] of Object.entries(req.headers)) {
      if (typeof val !== 'string') continue
      // 跳过 hop-by-hop 头（代理不转发 connection 级别的头）。
      const lower = key.toLowerCase()
      if (lower === 'host' || lower === 'origin' || lower === 'connection' ||
          lower === 'keep-alive' || lower === 'transfer-encoding' || lower === 'upgrade') {
        continue
      }
      headers[key] = val
    }
    // 归一化：Host 改写为上游权威（loopback）。
    headers['host'] = upstreamAuthority
    // Origin 同步归一化（防 Origin fence 拒绝）。
    if (req.headers['origin'] !== undefined) {
      headers['origin'] = upstreamOrigin
    }
    // 保留 upgrade 头（WebSocket 握手需要）——上面跳过了，这里加回。
    if (req.headers['upgrade'] !== undefined) {
      headers['upgrade'] = req.headers['upgrade'] as string
    }
    // 传递真实来源（审计 + IP 限速用）。
    headers['x-forwarded-for'] = clientIp
    headers['x-forwarded-proto'] = 'https'
    headers['x-forwarded-host'] = req.headers['host'] ?? upstreamAuthority
    return headers
  }

  function forward(req: IncomingMessage, res: ServerResponse, clientIp: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const headers = rewriteHeaders(req, clientIp)
      const proxyReq = httpRequest({
        hostname: upstreamHost,
        port: upstreamPort,
        path: req.url,
        method: req.method ?? 'GET',
        headers,
      }, (proxyRes) => {
        // 转发响应头 + 状态码。set-cookie 是数组（多个 cookie）——不能只取 string（审计 X3）。
        const respHeaders: Record<string, string | string[]> = {}
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          if (Array.isArray(val)) respHeaders[key] = val
          else if (typeof val === 'string') respHeaders[key] = val
        }
        res.writeHead(proxyRes.statusCode ?? 200, respHeaders)
        // 流式管道响应 body。
        proxyRes.pipe(res, { end: true })
        proxyRes.on('error', () => {
          if (!res.writableEnded) res.destroy()
        })
      })
      proxyReq.on('error', (err) => {
        if (!res.headersSent) {
          res.writeHead(502, { 'content-type': 'text/plain' })
          res.end('Bad Gateway')
        }
        if (!res.writableEnded) res.destroy()
        reject(err)
      })
      res.on('close', () => {
        if (!res.writableEnded) proxyReq.destroy()
      })
      // 流式管道请求 body（如有）。
      if (req.readable) {
        req.pipe(proxyReq, { end: true })
      } else {
        proxyReq.end()
      }
      res.on('finish', () => resolve())
    })
  }

  function forwardUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer, clientIp: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const upstream = netConnect(upstreamPort, upstreamHost)

      const onError = (err: Error): void => {
        if (!socket.destroyed) {
          socket.end([
            'HTTP/1.1 502 Bad Gateway',
            'Connection: close',
            'Content-Type: text/plain',
            '',
            'Upstream upgrade failed',
          ].join('\r\n'))
        }
        upstream.destroy()
        reject(err)
      }

      upstream.on('error', onError)
      socket.on('error', onError)

      upstream.on('connect', () => {
        // 写入改写后的 HTTP/1.1 upgrade 请求行+头。
        const headers = rewriteHeaders(req, clientIp)
        const path = req.url ?? '/'
        const requestLine = `${req.method ?? 'GET'} ${path} HTTP/1.1\r\n`
        const headerLines = Object.entries(headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')
        upstream.write(requestLine + headerLines + '\r\n\r\n')
        if (head.length > 0) upstream.write(head)

        // 双向管道：任一方向结束 → 销毁两端（防半开连接残留——审计 V27）。
        const cleanup = (): void => {
          if (!socket.destroyed) socket.destroy()
          if (!upstream.destroyed) upstream.destroy()
        }
        pipeline(socket, upstream, () => { resolve(); cleanup() })
        pipeline(upstream, socket, () => { cleanup() })
      })
    })
  }

  return { forward, forwardUpgrade }
}
