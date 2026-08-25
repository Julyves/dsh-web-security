/**
 * proxy 转发器单测：用真实 stub 上游 HTTP server 端到端验证。
 */
import { describe, expect, it } from 'vitest'
import { createServer, request as httpRequest } from 'node:http'
import { createProxy } from '../src/host/proxy'

describe('createProxy - HTTP 转发', () => {
  it('转发 GET 请求并回传响应', async () => {
    const upstream = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(`path=${req.url} host=${req.headers['host']}`)
    })
    await new Promise<void>(r => upstream.listen(0, r))
    const port = (upstream.address() as { port: number }).port
    const proxy = createProxy({ host: '127.0.0.1', port })

    // 用真实 HTTP 请求模拟「入口服务器收到请求后调 proxy.forward」。
    const testServer = createServer(async (req, res) => {
      await proxy.forward(req, res, '1.2.3.4')
    })
    await new Promise<void>(r => testServer.listen(0, r))
    const testPort = (testServer.address() as { port: number }).port

    const resp = await new Promise<string>((resolve) => {
      const r = httpRequest({ hostname: '127.0.0.1', port: testPort, path: '/api/test', method: 'GET' }, (res) => {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => resolve(`${res.statusCode} ${body}`))
      })
      r.end()
    })

    expect(resp).toContain('200')
    expect(resp).toContain('path=/api/test')

    testServer.close()
    upstream.close()
  })

  it('Host/Origin 归一化为上游 loopback（蓝图 D4）', async () => {
    let receivedHost = ''
    let receivedOrigin = ''
    let receivedXff = ''
    const upstream = createServer((req, res) => {
      const h = req.headers['host']
      const o = req.headers['origin']
      const x = req.headers['x-forwarded-for']
      receivedHost = Array.isArray(h) ? h[0]! : h ?? ''
      receivedOrigin = Array.isArray(o) ? o[0]! : o ?? ''
      receivedXff = Array.isArray(x) ? x[0]! : x ?? ''
      res.writeHead(200)
      res.end()
    })
    await new Promise<void>(r => upstream.listen(0, r))
    const port = (upstream.address() as { port: number }).port
    const proxy = createProxy({ host: '127.0.0.1', port })

    const testServer = createServer(async (req, res) => {
      await proxy.forward(req, res, '1.2.3.4')
    })
    await new Promise<void>(r => testServer.listen(0, r))
    const testPort = (testServer.address() as { port: number }).port

    await new Promise<void>(resolve => {
      const r = httpRequest({
        hostname: '127.0.0.1', port: testPort, path: '/', method: 'GET',
        headers: { host: 'myhost:3443', origin: 'https://myhost:3443' },
      }, () => resolve())
      r.end()
    })

    expect(receivedHost).toBe(`127.0.0.1:${port}`)
    expect(receivedOrigin).toBe(`http://127.0.0.1:${port}`)
    expect(receivedXff).toBe('1.2.3.4')

    testServer.close()
    upstream.close()
  })
})
