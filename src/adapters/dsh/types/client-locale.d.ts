/**
 * `@deepseek-ai/dsh-client-locale` 类型占位声明。
 *
 * 形状抄自 deepseek-harness `packages/client/locale` v0.1.1-rc.2：
 * Context 模块增强（ctx.locale）+ register/bind 面。词典结构为宽松
 * Record（宿主为强类型 LocaleDictOf 合并体系；本插件词典量小，宽类型够用）。
 */
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** locale 注册表服务（宿主 client-locale 提供）。 */
    readonly locale: {
      /** 注册一份词典；返回注销函数。 */
      register(ns: string, dicts: { zh: Record<string, string>; en: Record<string, string> }): () => void
      /** 绑定某 namespace 的翻译函数。 */
      bind(ns: string): (key: string, params?: Record<string, unknown>) => string
    }
  }
}

declare module '@deepseek-ai/dsh-client-locale/client' {
  export {}
}

declare module '@deepseek-ai/dsh-client-locale' {
  export * from '@deepseek-ai/dsh-client-locale/client'
}
