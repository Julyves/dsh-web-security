/**
 * `@deepseek-ai/dsh-client-ui-slots` 类型占位声明。
 *
 * 形状抄自 deepseek-harness `packages/client/ui-slots` v0.1.1-rc.2 的注册面
 * （SlotCore.register / slots.inject 包装器），按本插件消费面裁剪：
 * 宿主是完整四股合成类型系统（ComposedProps 等），本占位只保留
 * register 的宽松 options + 组件 FC 形态。运行时真实类型由宿主 loader 提供。
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  import type { Context } from '@deepseek-ai/cordis'
  import type { FC } from 'react'

  /** 槽位注册 options（宽松面：kind/scope 由声明方在运行时校验）。 */
  export interface SlotRegisterOptions {
    /** 目标槽位 key（贡献进入的槽）。 */
    name: string
    /** list 槽的条目 id / tab key。 */
    id?: string
    /** list 槽显示顺序（升序）。 */
    order?: number
    /** 显示文案（thunk 形式跟随 locale——宿主 resolveSlotLabel）。 */
    label?: string | (() => string)
    /** locale 命名空间（声明后组件 props 获得框架合成 t 座位）。 */
    locale?: string
    /** 注册方业务面工厂（组件 props 的 inject 股）。 */
    inject?: (...args: never[]) => Record<string, unknown>
    /** 诊断标识。 */
    registrant?: string
    /** 单/键槽遮蔽优先级（升序，最低者渲染）。 */
    priority?: number
  }

  /** 槽位注册函数类型。 */
  export type SlotRegister = (options: SlotRegisterOptions, component: FC<never>) => () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** slots 服务（宿主 ui-slots 的 runtime Service 包装）。 */
    readonly slots: {
      /**
       * 等待槽位声明后注册（宿主 client 规范：注册进他人声明的槽必须走
       * inject 包装器——等待声明、声明折叠时撤贡献、重声明时重跑）。
       */
      inject(name: string, factory: () => Iterator<unknown> | unknown): void
      /** 直接注册（槽必须已声明，否则抛错）。 */
      register(options: import('@deepseek-ai/dsh-client-ui-slots').SlotRegisterOptions, component: never): () => void
    }
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots/client' {
  export * from '@deepseek-ai/dsh-client-ui-slots'
}
