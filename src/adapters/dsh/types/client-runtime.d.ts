/**
 * `@deepseek-ai/dsh-client-runtime` 类型占位声明。
 *
 * 运行时由宿主 dsh 安装提供（peerDependencies 链）；本文件提供
 * dsh-web-security client 侧用到的编译期面（形状抄自 deepseek-harness
 * `packages/client/runtime` 与 `packages/api/remotes` v0.1.1-rc.2 的出口）。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** client 侧 Remote 贡献挂载服务（宿主 api-remotes 的 remote 服务）。 */
    readonly remote: {
      /**
       * 挂载一份 client Remote 贡献（zod descriptor 表）；返回注销函数。
       * 挂载完成后命名空间经本对象的动态代理属性访问。
       */
      $mount(contribution: unknown): Promise<() => void>
      /** 已挂载命名空间的动态代理（如 ctx.remote.security.status(...)）。 */
      [namespace: string]: unknown
    }
  }
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  import type { Context } from '@deepseek-ai/cordis'
  /** client 侧 Cordis 根 Context（宿主 client-runtime 的出口别名）。 */
  export type ClientContext = Context
}

declare module '@deepseek-ai/dsh-client-runtime' {
  export * from '@deepseek-ai/dsh-client-runtime/client'
}
