/**
 * `@deepseek-ai/dsh-client-ui-settings` 类型占位声明。
 *
 * 形状抄自 deepseek-harness `packages/client/ui-settings` v0.1.1-rc.2 的
 * `client/contract/slots.ts`（settings 槽位 owner props 契约）。本插件只
 * 消费 `settings.section`（list 槽，每条目一个设置页）。
 */
declare module '@deepseek-ai/dsh-client-ui-settings/client' {
  /** settings.section 槽的 owner 股（宿主 SettingsSectionOwnerProps）。 */
  export interface SettingsSectionOwnerProps {
    /** 关闭设置面板（宿主持有开合状态）。 */
    close: () => void
  }
}

declare module '@deepseek-ai/dsh-client-ui-settings' {
  export * from '@deepseek-ai/dsh-client-ui-settings/client'
}
