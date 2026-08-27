/**
 * dsh-web-security build script（自包含；亦作为 git 安装的 `prepare`
 * 运行——不得假设 monorepo 检出或开发期上下文）。
 *
 * 1. Host 半：tsc 产出 `lib/host/`（ESM + 声明）。永不 minify——Gateway
 *    SRC 模式反射方法参数名做 wire 字段映射，重命名即破坏契约。
 * 2. Client 半：esbuild 将 `src/client/index.ts` 打包为单文件
 *    `lib/client.js` —— `window.__ModuleLoader__.load({ id, factory })`
 *    闭包格式（由 dsh-client-modules 服务）。平台模块（react、
 *    @deepseek-ai/*）保持 external，经 loader 模块表解析；普通库内联。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)))

const BUNDLE_ID = 'dsh-web-security'

// 先清空 lib/：防止陈旧产物（旧 sourcemap、被移除模块的声明）混入发布面。
rmSync(resolve(ROOT, 'lib'), { recursive: true, force: true })

/** 浏览器 loader 提供的平台模块；bundle 中必须保持 external。
 * 精确对齐宿主 web shell 的冻结静态模块表
 * （deepseek-harness packages/client/web/src/platform.ts 的 PLATFORM_MODULES）：
 * react 系 + cordis + ui-slots + ui-primitives。其余 @deepseek-ai/dsh-client-*
 * 不在静态表内（如 schema-form/web-react/ui-attachment），引用它们会在运行时
 * 因 loader 模块表无法解析而失败——不得列入。 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

/** 运行时解析的外部包：宿主 dsh 安装提供 @deepseek-ai/*（peerDependencies）。 */
const HOST_EXTERNALS = ['@deepseek-ai/*']

function run(cmd, args) {
  const result = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', encoding: 'utf8' })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

// ── Host 半：tsc 声明 + esbuild bundle（永不 minify——SRC 反射参数名）──
run('npx', ['tsc', '-p', 'tsconfig.build.json'])
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/host/index.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  external: HOST_EXTERNALS,
  minify: false,
  sourcemap: false,
  outfile: resolve(ROOT, 'lib/host/index.js'),
  logLevel: 'info',
})

// ── Client 半：单文件 bundle ──────────────────────────────────────────────
// CJS 格式 + banner/footer 将整个 bundle 包进 ModuleLoader 交接
// `load({ id, factory: (require) => { ... } })`：factory 即 bundle 本体，
// 所有 external require（平台模块）在具体化时经 loader 提供的 require 解析——
// 与宿主 client-bundle 契约一致（副作用在 factory 内执行）。
await esbuild.build({
  entryPoints: [resolve(ROOT, 'src/client/index.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  external: PLATFORM_MODULES,
  minify: true,
  sourcemap: false,
  outfile: resolve(ROOT, 'lib/client.js'),
  logLevel: 'info',
  banner: {
    js: 'var module = { exports: {} }; var exports = module.exports;\n'
      + `window.__ModuleLoader__.load({ id: ${JSON.stringify(BUNDLE_ID)}, factory: (require) => {`,
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

// ── 产物断言 ──────────────────────────────────────────────────────────────
const client = readFileSync(resolve(ROOT, 'lib/client.js'), 'utf8')
if (!client.includes('__ModuleLoader__.load')) {
  console.error('build: lib/client.js 缺少 __ModuleLoader__.load 入口')
  process.exit(1)
}
if (!client.includes(`'${BUNDLE_ID}'`) && !client.includes(`"${BUNDLE_ID}"`)) {
  console.error(`build: lib/client.js 未携带 bundle id ${BUNDLE_ID}`)
  process.exit(1)
}
for (const required of ['lib/host/index.js', 'lib/client.js']) {
  const path = resolve(ROOT, required)
  if (!existsSync(path)) {
    console.error(`build: 缺失产物 ${required}`)
    process.exit(1)
  }
}
mkdirSync(resolve(ROOT, 'lib'), { recursive: true })
writeFileSync(resolve(ROOT, 'lib/.keep'), '')
console.log('build: OK — lib/host/（tsc）+ lib/client.js（esbuild ModuleLoader 闭包）')