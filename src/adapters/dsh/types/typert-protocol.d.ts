/**
 * `@deepseek-ai/dsh-typert-protocol` 类型占位声明。
 *
 * 与 cordis.d.ts 同理：运行时实现由宿主 dsh 安装提供（peerDependency）；
 * 本文件提供 dsh-web-security 用到的编译期面（形状抄自 deepseek-harness
 * `packages/typert/protocol` 源码 v0.1.1-rc.2）。
 */
declare module '@deepseek-ai/dsh-typert-protocol' {
  import type { Context, Service } from '@deepseek-ai/cordis'

  /** 一个 Service 参与 Typert Gateway 导出的可见声明。 */
  export interface TypertGatewayBinding<ServiceT extends object = object> {
    readonly service: ServiceT
    readonly serviceKey: string
    readonly namespace: string
  }

  /** 通过 Typert Gateway 注册具名 Remote 的 Cordis 服务基类。 */
  export abstract class TypertRemoteService<out T = never> extends Service<T> {
    /** Gateway 源码模式发现消费的可见绑定。 */
    readonly typertRemote: TypertGatewayBinding<this>
    protected constructor(ctx: Context, serviceKey: string, options?: { namespace?: string })
  }

  /** 标记一个 Remote 端点的标准方法装饰器（不可直接调用，仅类型）。 */
  export type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
    method: (this: This, ...args: Args) => Result,
    context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
  ) => void

  /** 将方法标记为直接的 Remote 调用（宿主 SRC 反射其参数名）。 */
  export function Remote(exportName: string): RemoteMethodDecorator
}