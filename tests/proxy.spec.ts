/**
 * proxy 转发器单测：用真实 stub 上游 HTTP server 端到端验证。
 */
import { describe, expect, it } from 'vitest'
import { createServer, request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
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

describe('createProxy - WebSocket upgrade 转发', () => {
  it('握手头完整转发（Connection: Upgrade 成对）+ 101 透传 + 双向数据', async () => {
    const WS_KEY = 'dGhlIHNhbXBsZSBub25jZQ=='
    let upstreamGotConnection = ''
    let upstreamGotUpgrade = ''
    let upstreamGotKey = ''
    let upstreamGotHost = ''
    let upstreamUpgradeFired = false

    // 真实上游：只注册 upgrade handler（与宿主 connection 的 WS 路由同构）。
    const upstream = createServer()
    upstream.on('upgrade', (req: IncomingMessage, socket: Duplex) => {
      upstreamUpgradeFired = true
      upstreamGotConnection = String(req.headers['connection'] ?? '')
      upstreamGotUpgrade = String(req.headers['upgrade'] ?? '')
      upstreamGotKey = String(req.headers['sec-websocket-key'] ?? '')
      upstreamGotHost = String(req.headers['host'] ?? '')
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=\r\n` +
        '\r\n',
      )
      socket.write('upstream-hello:')
      socket.on('data', (chunk) => { socket.write(`echo:${chunk.toString()}`) })
    })
    await new Promise<void>(r => upstream.listen(0, r))
    const upstreamPort = (upstream.address() as { port: number }).port
    const proxy = createProxy({ host: '127.0.0.1', port: upstreamPort })

    // 模拟入口服务器：upgrade 事件转发给 proxy.forwardUpgrade。
    const testServer = createServer()
    testServer.on('upgrade', (req, socket, head) => {
      void proxy.forwardUpgrade(req, socket, head, '1.2.3.4').catch(() => {
        if (!socket.destroyed) socket.destroy()
      })
    })
    await new Promise<void>(r => testServer.listen(0, r))
    const testPort = (testServer.address() as { port: number }).port

    // 客户端：node http 手工升级请求（浏览器 WS 握手同构头）。
    const result = await new Promise<{ status: number; data: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('upgrade 握手超时（上游未触发 upgrade 事件或 101 未回）')), 3000)
      const r = httpRequest({
        hostname: '127.0.0.1', port: testPort, path: '/api/events.mux', method: 'GET',
        headers: {
          host: `localhost:${testPort}`,
          connection: 'Upgrade',
          upgrade: 'websocket',
          'sec-websocket-key': WS_KEY,
          'sec-websocket-version': '13',
        },
      })
      r.on('upgrade', (res, socket, upgradeHead) => {
        // head 携带 101 之后的首批字节（可能与握手响应粘包），并入 data 初值。
        let data = upgradeHead.toString()
        if (data.length > 0 && data.includes('upstream-hello:')) {
          socket.write('ping-from-client')
        }
        socket.on('data', (c) => {
          data += c.toString()
          if (data.includes('upstream-hello:')) {
            socket.write('ping-from-client')
          }
          if (data.includes('echo:ping-from-client')) {
            clearTimeout(timeout)
            resolve({ status: res.statusCode ?? 0, data })
          }
        })
        if (data.includes('echo:ping-from-client')) {
          clearTimeout(timeout)
          resolve({ status: res.statusCode ?? 0, data })
        }
      })
      r.on('response', (res) => {
        clearTimeout(timeout)
        reject(new Error(`上游未升级，按普通 HTTP 响应了：${res.statusCode}`))
      })
      r.end()
    })

    // 断言：上游 upgrade 事件触发 + 握手头完整（Connection/Upgrade 成对 + key 透传 + host 归一化）。
    expect(upstreamUpgradeFired).toBe(true)
    expect(upstreamGotUpgrade.toLowerCase()).toBe('websocket')
    expect(upstreamGotConnection.toLowerCase()).toContain('upgrade')
    expect(upstreamGotKey).toBe(WS_KEY)
    expect(upstreamGotHost).toBe(`127.0.0.1:${upstreamPort}`)
    // 客户端收到 101 + 上行帧 + 双向透传（客户端数据经上游 echo 回来）。
    expect(result.status).toBe(101)
    expect(result.data).toContain('upstream-hello:')
    expect(result.data).toContain('echo:ping-from-client')

    testServer.close()
    upstream.close()
  })
})
