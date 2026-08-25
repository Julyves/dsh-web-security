/**
 * `@deepseek-ai/cordis` 类型占位声明。
 *
 * npm 生态不带完整 dsh 包链（`@deepseek-ai/cordis` 依赖未发布包），本包无法
 * 将其装为 devDependency；运行时由宿主 dsh 安装经 peerDependency 解析提供。
 * 本文件只提供 dsh-web-security 用到的编译期面（形状抄自 deepseek-harness
 * vendor 树 v0.1.1-rc.2），与宿主升级时同步维护。
 */
declare module '@deepseek-ai/cordis' {
  /** 最小 Context 面（host/client 两侧使用）。 */
  export interface Context {
    /** 任意命名的服务注册表反射（Gateway SRC 发现用）。 */
    readonly reflect: {
      readonly props: Record<string, { type?: string; [key: string]: unknown }>
      provide(name: string, value: unknown, check?: unknown): void
    }
    /** 按 key 取可选服务（未提供时为 undefined）。 */
    get<T = unknown>(key: string): T | undefined
    /** 声明本插件激活前需要的服务。 */
    inject(keys: readonly string[], callback: (ctx: Context) => void): void
    /** 注册副作用（fiber 释放时自动清理；返回 disposer 亦可）。 */
    effect(callback: () => void | (() => void | Promise<void>), label?: string): void
    /** 订阅应用事件；返回取消订阅函数。 */
    on<K extends string>(event: K, listener: (...args: never[]) => void): (() => void) | void
    /** 启动嵌套插件 fiber。 */
    plugin(plugin: unknown, config?: unknown): Promise<unknown> & { dispose(): Promise<void> }
    /** 结构化日志器（`logger.warn/info/error` 等）。 */
    readonly logger: {
      warn(message: unknown, ...args: unknown[]): void
      info(message: unknown, ...args: unknown[]): void
      error(message: unknown, ...args: unknown[]): void
    }
    [key: string]: unknown
  }

  /** 在 `ctx` 上注册具名 API 的服务基类。 */
  export abstract class Service<out T = never> {
    static readonly init: unique symbol
    static readonly check: unique symbol
    static readonly config: unique symbol
    static readonly invoke: unique symbol
    static readonly extend: unique symbol
    static readonly tracker: unique symbol
    static readonly resolveConfig: unique symbol
    /** 服务实例注册名。 */
    public name!: string
    /** 所属 Context（经 `super(ctx, name)` 注册）。 */
    readonly ctx: Context
    constructor(ctx: Context, name: string)
  }
}