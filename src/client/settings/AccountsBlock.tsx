/**
 * 账号管理区块：列表 + 创建表单 + 行内改密 + 删除（RiskConfirmation）。
 *
 * 数据经注入面回调（loadAccounts/createAccount/updatePassword/removeAccount
 * ——宿主 client 规范：live data 走 inject，组件零订阅机械）。错误态呈现
 * host 返回的可读 message（强度/字符集/自锁死校验在 host——单一权威源）。
 */
import { useEffect, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { Button, Input, Pill, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import { form, list } from './styles.ts'

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
  updatePassword(username: string, currentPassword: string, newPassword: string): Promise<Envelope<void>>
  removeAccount(username: string): Promise<Envelope<void>>
}

/** 账号区块 props。 */
export interface AccountsBlockProps {
  t: (key: string) => string
  api: AccountsApi
}

/** 单账号行：用户名 + 改密/删除入口 + 行内改密表单。 */
function AccountRow({ account, t, api, onRemoved }: {
  account: AccountSummaryView
  t: (key: string) => string
  api: AccountsApi
  onRemoved: (username: string) => void
}): ReactNode {
  const [editing, setEditing] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [rowError, setRowError] = useState<string | undefined>(undefined)
  const [updated, setUpdated] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  async function submitPassword(): Promise<void> {
    const result = await api.updatePassword(account.username, current, next)
    if (result.ok) {
      setEditing(false)
      setCurrent('')
      setNext('')
      setRowError(undefined)
      setUpdated(true)
    } else {
      setRowError(result.error.message)
    }
  }

  async function submitRemove(): Promise<void> {
    const result = await api.removeAccount(account.username)
    setConfirmingRemove(false)
    if (result.ok) onRemoved(account.username)
    else setRowError(result.error.message)
  }

  return (
    <li data-account={account.username} style={list.row}>
      <span style={list.name}>{account.username}</span>
      {account.hasPasskey ? <Pill>{t('hasPasskey')}</Pill> : null}
      <span style={list.actions}>
        <Button data-action="password-open" data-username={account.username} onClick={() => { setEditing(!editing); setUpdated(false); setRowError(undefined) }}>
          {t('changePassword')}
        </Button>
        <Button data-action="remove-open" data-username={account.username} onClick={() => { setConfirmingRemove(true); setRowError(undefined) }}>
          {t('removeAccount')}
        </Button>
      </span>
      {updated ? <span data-updated="" style={{ color: 'var(--dsw-alias-label-success, #2e7d32)', fontSize: '12px' }}>{t('passwordUpdated')}</span> : null}
      {editing
        ? (
            <form data-role="password-edit" data-username={account.username} onSubmit={(e) => { e.preventDefault(); void submitPassword() }} style={{ ...form.row, width: '100%', marginTop: '8px', paddingTop: '8px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08))' }}>
              <span style={form.field}><Input value={current} onChange={setCurrent} type="password" placeholder={t('currentPassword')} autoComplete="current-password" /></span>
              <span style={form.field}><Input value={next} onChange={setNext} type="password" placeholder={t('newPassword')} autoComplete="new-password" /></span>
              <Button data-action="password-submit" disabled={current === '' || next === ''} onClick={() => { void submitPassword() }}>
                {t('submit')}
              </Button>
            </form>
          )
        : null}
      {confirmingRemove
        ? (
            <div style={{ width: '100%' }}>
              <RiskConfirmation confirm={() => { void submitRemove() }} cancel={() => setConfirmingRemove(false)}>
                {t('confirmRemove')}
              </RiskConfirmation>
            </div>
          )
        : null}
      {rowError !== undefined && !confirmingRemove ? <p data-row-error="" style={form.error}>{rowError}</p> : null}
    </li>
  )
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <section data-block="accounts" data-state={state} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {state === 'error'
          ? <p data-error="" style={form.error}>{t('loadFailed')}</p>
          : state === 'ready'
            ? (
                <ul style={list.ul}>
                  {accounts.map((a) => (
                    <AccountRow
                      key={a.username}
                      account={a}
                      t={t}
                      api={api}
                      onRemoved={(u) => { setAccounts(accounts.filter(x => x.username !== u)) }}
                    />
                  ))}
                </ul>
              )
            : null}
        <form data-role="account-create" onSubmit={(e) => { e.preventDefault(); void submit() }} style={form.row}>
          <span style={form.field}><Input value={username} onChange={setUsername} placeholder={t('username')} autoComplete="username" /></span>
          <span style={form.field}><Input value={password} onChange={setPassword} type="password" placeholder={t('password')} autoComplete="new-password" /></span>
          <Button data-action="account-create" disabled={creating || username === '' || password === ''} onClick={() => { void submit() }}>
            {t('create')}
          </Button>
        </form>
        {formError !== undefined ? <p data-form-error="" style={form.error}>{formError}</p> : null}
      </section>
    </div>
  )
}

/** 区块占位导出（保持既有 Section 引用稳定）。 */
export function SectionPlaceholder(): ReactNode {
  return null
}
