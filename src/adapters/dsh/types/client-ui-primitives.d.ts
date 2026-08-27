/**
 * `@deepseek-ai/dsh-client-ui-primitives` 类型占位声明。
 *
 * 形状抄自 deepseek-harness `packages/client/ui-primitives` v0.1.1-rc.2
 * 的导出面（本插件消费的子集）：Button/Input/Pill/RiskConfirmation/
 * DisclosureRow。完整原语清单见快照 src/index.ts；此处只声明消费面，
 * props 取各原语的核心字段（宽类型，宿主真实类型更严）。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { FC, ReactNode } from 'react'

  /** 按钮原语。 */
  export const Button: FC<{
    children?: ReactNode
    onClick?: () => void
    disabled?: boolean
    type?: 'button' | 'submit'
    variant?: string
  }>

  /** 输入框原语。 */
  export const Input: FC<{
    value: string
    onChange: (value: string) => void
    type?: string
    placeholder?: string
    disabled?: boolean
    autoComplete?: string
  }>

  /** 徽章原语。 */
  export const Pill: FC<{ children?: ReactNode }>

  /** 折叠行原语。 */
  export const DisclosureRow: FC<{
    label?: ReactNode
    children?: ReactNode
  }>

  /** 风险操作二次确认原语（删除账号/降级设置等）。 */
  export const RiskConfirmation: FC<{
    children?: ReactNode
    confirm: () => void
    cancel?: () => void
    open?: boolean
  }>
}

declare module '@deepseek-ai/dsh-client-ui-primitives/client' {
  export * from '@deepseek-ai/dsh-client-ui-primitives'
}
