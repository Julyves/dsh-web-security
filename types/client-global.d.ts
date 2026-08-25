/**
 * 浏览器模块加载器契约（宿主 dsh-client-modules 提供）。
 * client bundle 经 `window.__ModuleLoader__.load({ id, factory })` 注册；
 * `factory(require)` 从 loader 模块表解析平台模块。
 */
interface ModuleLoaderPayload {
  readonly id: string
  readonly factory: (require: (specifier: string) => unknown) => void
}

interface Window {
  __ModuleLoader__: { load(payload: ModuleLoaderPayload): void }
}