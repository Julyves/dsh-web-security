/**
 * `@deepseek-ai/dsh-client-runtime` 类型占位声明。
 *
 * 运行时由宿主 dsh 安装提供（peerDependencies 链）；本文件提供
 * dsh-web-security client 侧用到的编译期面（形状抄自 deepseek-harness
 * `packages/client/runtime` 源码 v0.1.1-rc.2 的 ClientContext 出口）。
 */
declare module '@deepseek-ai/dsh-client-runtime/client' {
  import type { Context } from '@deepseek-ai/cordis'
  /** client 侧 Cordis 根 Context（宿主 client-runtime 的出口别名）。 */
  export type ClientContext = Context
}

declare module '@deepseek-ai/dsh-client-runtime' {
  export * from '@deepseek-ai/dsh-client-runtime/client'
}
