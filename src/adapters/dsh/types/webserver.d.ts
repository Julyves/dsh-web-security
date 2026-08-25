/**
 * `@deepseek-ai/dsh-host-webserver` 类型占位声明。
 *
 * 与 cordis.d.ts 同理：运行时实现由宿主 dsh 安装提供（peerDependency）；
 * 本文件提供 dsh-web-security 用到的编译期面（形状抄自 deepseek-harness
 * `packages/host/webserver/src` 源码 v0.1.1-rc.2）。
 */
declare module '@deepseek-ai/dsh-host-webserver' {
  import type { Context, Service } from '@deepseek-ai/cordis'
  import type { IncomingMessage, ServerResponse } from 'node:http'
  import type { Duplex } from 'node:stream'

  /** 路由匹配类型：'exact' 精确匹配；'prefix' 匹配 p 与 p/<anything>。 */
  export type WebRouteKind = 'exact' | 'prefix'

  /** 一条具名路由注册。 */
  export interface WebRoute {
    kind: WebRouteKind
    /** 绝对路径名，无尾斜杠。 */
    path: string
    /** 拥有完整响应生命周期（可挂起响应，如 SSE）。 */
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }

  /** 一条精确路径 HTTP upgrade 注册。 */
  export interface WebUpgradeRoute {
    /** 绝对路径名，无尾斜杠。 */
    path: string
    /** 负责协议协商与 upgrade 后的 socket 使用。 */
    handler: (req: IncomingMessage, socket: Duplex, head: Buffer) => void | Promise<void>
  }

  /** 注入行落点：head 或 body 开标签之后。 */
  export type IndexInjectionPlacement = 'head' | 'body'

  /**
   * 结构化 index 注入行（kind 判别联合，形状抄自宿主 injections.ts）。
   * 登录门脚本注入用 `script-src`（外链脚本）或 `script`（内联）。
   */
  export type IndexInjection =
    /** 向 `globalThis` 赋一个 JSON 可序列化值（先于后续 script 行）。 */
    | { kind: 'global'; name: string; value: unknown }
    /** 内联经典脚本；text 不得含 `</script`。 */
    | { kind: 'script'; placement: IndexInjectionPlacement; text: string }
    /** 外链经典脚本，按表序执行。 */
    | { kind: 'script-src'; placement: IndexInjectionPlacement; src: string }
    /** head 内 `<style>` 元素。 */
    | { kind: 'style'; text: string }
    /** 原始 HTML 片段。 */
    | { kind: 'html'; placement: IndexInjectionPlacement; html: string }

  /** 浏览器 HTTP 载体服务：路由注册表 + fallback 座位 + index 注入。 */
  export class WebServer extends Service {
    /** 实际监听端口（config.port 为 0 时取 OS 分配值）。 */
    readonly port: number
    /** 配置的绑定主机。 */
    readonly host: '127.0.0.1' | '0.0.0.0'
    /** 注册具名路由（同 kind+path 重复注册抛错）；返回移除 disposer。 */
    register(route: WebRoute): () => void
    /** 注册精确路径 upgrade 路由；返回移除 disposer。 */
    registerUpgrade(route: WebUpgradeRoute): () => void
    /** 认领 fallback 座位（唯一持有者，二次注册抛错）；返回释放 disposer。 */
    registerFallback(handler: WebRoute['handler']): () => void
    /** 注册原始 HTML index 变换（按注册顺序应用）；返回移除 disposer。 */
    tapIndex(transform: (html: string) => string): () => void
    /** 收集结构化注入表（一次 `webserver/index-inject` emit）。 */
    collectIndexInjections(): IndexInjection[]
    /** 渲染一份 index.html：结构化注入表 + 原始 tap 变换。 */
    renderIndex(html: string): string
    constructor(ctx: Context, config: { host: '127.0.0.1' | '0.0.0.0'; port: number })
  }
}