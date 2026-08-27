/**
 * 账号管理区块：列表 + 创建表单。
 *
 * 数据经注入面回调（loadAccounts/createAccount——宿主 client 规范：
 * live data 走 inject，组件零订阅机械）。错误态呈现 host 返回的可读
 * message（强度/字符集校验在 host——单一权威源）。
 */
import { useEffect, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'

/** 账号摘要视图（AccountSummary 镜像）。 */
export interface AccountSummaryView {
  readonly username: string
  readonly hasPasskey: boolean
  readonly createdAt: number
}

/** 远端调用结果信封（RemoteEnvelope 镜像）。 */
export type Envelope<T> = { ok: true; value: T } | { ok: false; error: { code: string; message: string } }

/** 账号区块注入面。 */
export interface AccountsApi {
  loadAccounts(): Promise<readonly AccountSummaryView[]>
  createAccount(username: string, password: string): Promise<Envelope<void>>
}

/** 账号区块 props。 */
export interface AccountsBlockProps {
  t: (key: string) => string
  api: AccountsApi
}

/** 账号管理区块组件。 */
export const AccountsBlock: FC<AccountsBlockProps> = ({ t, api }) => {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [accounts, setAccounts] = useState<readonly AccountSummaryView[]>([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [formError, setFormError] = useState<string | undefined>(undefined)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.loadAccounts()
      .then((list) => { if (!cancelled) { setAccounts(list); setState('ready') } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [api])

  async function submit(): Promise<void> {
    if (creating) return
    setCreating(true)
    setFormError(undefined)
    const result = await api.createAccount(username, password)
    if (result.ok) {
      setUsername('')
      setPassword('')
      try {
        setAccounts(await api.loadAccounts())
      } catch { /* 刷新失败保留旧列表；下次渲染重试 */ }
    } else {
      setFormError(result.error.message)
    }
    setCreating(false)
  }

  return (
    <section data-section="" data-block="accounts" data-state={state}>
      <h3>{t('accountsTitle')}</h3>
      {state === 'error'
        ? <p data-error="">{t('loadFailed')}</p>
        : state === 'ready'
          ? (
              <ul>
                {accounts.map((a) => <li key={a.username}>{a.username}</li>)}
              </ul>
            )
          : null}
      <form data-role="account-create" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <Input value={username} onChange={setUsername} placeholder={t('username')} autoComplete="username" />
        <Input value={password} onChange={setPassword} type="password" placeholder={t('password')} autoComplete="new-password" />
        {formError !== undefined ? <p data-form-error="">{formError}</p> : null}
        <Button data-action="account-create" disabled={creating || username === '' || password === ''} onClick={() => { void submit() }}>
          {t('create')}
        </Button>
      </form>
    </section>
  )
}

/** 区块占位导出（保持既有 Section 引用稳定）。 */
export function SectionPlaceholder(): ReactNode {
  return null
}
