/**
 * dsh-web-security client 入口：Cordis 约定字段 + 委托。
 *
 * 骨架阶段仅声明注入面与标识；M4 起在这里：
 *   - 注册设置界面 slots（账号管理 / 入口配置 / 审计查看）；
 *   - 挂载 typert `security` 命名空间 Remote（child fiber 读取，防死锁）；
 *   - 登录门状态轮询（登录页与设置界面的状态联动）。
 * 登录页本身是独立零框架 bundle（src/client/login/，M3），不经本入口加载。
 */

/** Cordis 插件约定：声明需要的服务。 */
export const inject = ['slots', 'remote', 'locale'] as const

/** 插件标识（与包名一致）。 */
export const name = 'dsh-web-security'

/** Cordis 插件入口：适配 Context 后委托给纯业务函数（M4 填充）。 */
export function apply(ctx: unknown): void {
  void ctx
}