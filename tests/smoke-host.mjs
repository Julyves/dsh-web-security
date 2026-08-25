/**
 * 构建产物冒烟测试：对 lib/host/index.js 做宿主装配验证。
 *
 * 用最小 stub ctx 实例化 SecurityService（真实五模块 + 临时 plugin-data 目录），
 * 验证：构造不挂起、status 端点可调、accountCreate + login 闭环可走通。
 * 不验证真实 typert Gateway（需独立 profile）——那是关卡 8 的后续步骤。
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = process.cwd()
const { default: SecurityService } = await import(join(ROOT, 'lib/host/index.js'))

// ── 最小 stub ctx（满足 TypertRemoteService 构造的 ctx 表面）──
const stubCtx = {
  root: undefined,
  reflect: { props: {}, provide() {} },
  get: () => undefined,
  inject: (_keys, cb) => { cb(stubCtx) },
  effect: () => {},
  on: () => () => {},
  plugin: () => Promise.resolve(),
  logger: { warn() {}, info() {}, error() {} },
}

const tmpDir = await mkdtemp(join(tmpdir(), 'dsh-web-security-smoke-'))

try {
  // 实例化（真实五模块装配 + 临时目录）
  const svc = new SecurityService(stubCtx, {
    enabled: true,
    entry: { host: '0.0.0.0', port: 3443, tls: { certPath: null, keyPath: null } },
    session: { ttlMinutes: 480 },
    rateLimit: { maxAttempts: 5, windowMinutes: 15 },
    dshHome: tmpDir,
    rpID: '',
  })

  // status 端点可调
  const status = await svc.status({})
  if (status.enabled !== true) throw new Error('status.enabled 应为 true')
  if (status.entry.port !== 3443) throw new Error('status.entry.port 应为 3443')
  console.log('✅ status 端点可调，entry:', JSON.stringify(status.entry))

  // hasAccounts 应为 null（未认证请求——审计 M1）
  if (status.hasAccounts !== null) throw new Error('status.hasAccounts 应为 null')
  console.log('✅ hasAccounts=null（不泄露初始化状态）')

  // accountCreate → 创建首个管理员（loopback 信任——审计 S1）
  const createResult = await svc.accountCreate({ username: 'admin', password: 'SecurePass123!' })
  if (!createResult.ok) throw new Error(`accountCreate 失败: ${JSON.stringify(createResult.error)}`)
  console.log('✅ accountCreate 成功')

  // login → 正确密码
  const loginResult = await svc.login({ username: 'admin', password: 'SecurePass123!' })
  if (!loginResult.ok) throw new Error(`login 失败: ${JSON.stringify(loginResult)}`)
  if (!loginResult.cookie) throw new Error('login 成功但未返回 cookie')
  console.log('✅ login 正确密码成功 + cookie 已签发')

  // login → 错误密码
  const failResult = await svc.login({ username: 'admin', password: 'WrongPass123!' })
  if (failResult.ok) throw new Error('错误密码不应成功')
  if (failResult.code !== 'bad-credentials') throw new Error(`期望 bad-credentials，得到 ${failResult.code}`)
  console.log('✅ login 错误密码返回 bad-credentials')

  // accountsList
  const accounts = await svc.accountsList({})
  if (accounts.length !== 1) throw new Error(`期望 1 个账号，得到 ${accounts.length}`)
  if (accounts[0].username !== 'admin') throw new Error('账号名不匹配')
  console.log('✅ accountsList 返回 1 个账号')

  // settingsRead
  const settings = await svc.settingsRead({})
  if (settings.passwordLogin !== true) throw new Error('passwordLogin 应为 true')
  console.log('✅ settingsRead 返回默认设置')

  // settingsWrite → 关闭 auditEnabled（审计 M2：触发 settings-changed 事件）
  const writeResult = await svc.settingsWrite({ auditEnabled: false })
  if (!writeResult.ok) throw new Error('settingsWrite 失败')
  if (writeResult.value.auditEnabled !== false) throw new Error('auditEnabled 未更新')
  console.log('✅ settingsWrite 关闭 auditEnabled')

  // auditRead（等待防抖落盘 1s + buffer flush 后磁盘才有数据）
  await new Promise(r => setTimeout(r, 1200))
  const audit = await svc.auditRead({ offset: 0, limit: 10 })
  if (audit.events.length === 0) throw new Error('期望审计事件 > 0')
  console.log(`✅ auditRead 返回 ${audit.events.length} 条事件`)

  console.log('\n冒烟测试全部通过 ✅')
} finally {
  await rm(tmpDir, { recursive: true, force: true })
}
