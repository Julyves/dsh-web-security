/**
 * 通行密钥管理区块：账号选择 + 凭证列表 + 注册（WebAuthn）+ 移除。
 *
 * WebAuthn 是浏览器系统边界（navigator.credentials）——组件在编排层调用；
 * begin/complete 经注入面走 remote（host 校验 challenge/origin——M3 webauthn）。
 * 浏览器不支持（无 credentials API 或非 secure context）时注册入口禁用并
 * 说明原因（Story 14）。
 */
import { useEffect, useState } from 'react'
import type { FC, ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AccountSummaryView, Envelope } from './AccountsBlock.tsx'
import { base64urlToBuffer, bufferToBase64url } from './webauthn-codec.ts'
import { form, list } from './styles.ts'

/** 凭证摘要视图。 */
export interface PasskeyView {
  readonly credentialId: string
}

/** 通行密钥区块注入面。 */
export interface PasskeysApi {
  loadAccounts(): Promise<readonly AccountSummaryView[]>
  listPasskeys(username: string): Promise<readonly PasskeyView[]>
  registerBegin(username: string): Promise<Envelope<Record<string, unknown>>>
  registerComplete(username: string, credential: unknown): Promise<Envelope<void>>
  removePasskey(username: string, credentialId: string): Promise<Envelope<void>>
}

/** 通行密钥区块 props。 */
export interface PasskeysBlockProps {
  t: (key: string) => string
  api: PasskeysApi
  /** 服务器是否已配置 rpID（决定通行密钥是否可用）。 */
  serverAvailable?: boolean
}

/** 浏览器 WebAuthn 可用性探测（secure context + credentials API）。 */
export function webAuthnAvailable(): boolean {
  return typeof window !== 'undefined'
    && window.isSecureContext === true
    && typeof navigator !== 'undefined'
    && navigator.credentials !== undefined
    && typeof navigator.credentials.create === 'function'
}

/** 通行密钥区块组件。 */
export const PasskeysBlock: FC<PasskeysBlockProps> = ({ t, api, serverAvailable }) => {
  const [accounts, setAccounts] = useState<readonly AccountSummaryView[]>([])
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [creds, setCreds] = useState<readonly PasskeyView[]>([])
  const [blockError, setBlockError] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const available = webAuthnAvailable()

  useEffect(() => {
    let cancelled = false
    api.loadAccounts().then((list) => { if (!cancelled) setAccounts(list) })
      .catch(() => { if (!cancelled) setBlockError(t('loadFailed')) })
    return () => { cancelled = true }
  }, [api, t])

  async function pick(username: string): Promise<void> {
    setSelected(username)
    setBlockError(undefined)
    try {
      setCreds(await api.listPasskeys(username))
    } catch {
      setBlockError(t('loadFailed'))
    }
  }

  async function register(): Promise<void> {
    if (selected === undefined || busy || !available || serverAvailable !== true) return
    setBusy(true)
    setBlockError(undefined)
    try {
      const begin = await api.registerBegin(selected)
      if (!begin.ok) {
        setBlockError(begin.error.message)
        return
      }
      // options 解码：challenge / user.id / excludeCredentials[].id（base64url → ArrayBuffer）。
      const raw = begin.value as {
        challenge?: string
        user?: { id?: string }
        excludeCredentials?: readonly { id?: string }[]
      }
      const publicKey = {
        ...(begin.value as Record<string, unknown>),
        challenge: base64urlToBuffer(String(raw.challenge ?? '')),
        user: raw.user !== undefined
          ? { ...raw.user, id: base64urlToBuffer(String(raw.user.id ?? '')) }
          : undefined,
        excludeCredentials: raw.excludeCredentials?.map(c => ({ ...c, id: base64urlToBuffer(String(c.id ?? '')) })),
      }
      // options 来自 host JSON（完整 CreationOptions 字段）+ 解码后的二进制位；
      // 字段完备性由 host webauthn 服务保证，此处仅做 wire→DOM 类型桥接。
      const credential = await navigator.credentials.create({
        publicKey: publicKey as PublicKeyCredentialCreationOptions,
      }) as {
        id: string
        rawId: ArrayBuffer
        type: string
        clientExtensionResults: Record<string, unknown>
        response: { clientDataJSON: ArrayBuffer; attestationObject: ArrayBuffer; transports?: string[] }
      } | null
      if (credential === null) {
        setBlockError(t('passkeyCancelled'))
        return
      }
      const serialized = {
        id: credential.id,
        rawId: bufferToBase64url(credential.rawId),
        type: credential.type,
        clientExtensionResults: credential.clientExtensionResults ?? {},
        response: {
          clientDataJSON: bufferToBase64url(credential.response.clientDataJSON),
          attestationObject: bufferToBase64url(credential.response.attestationObject),
        },
      }
      const complete = await api.registerComplete(selected, serialized)
      if (!complete.ok) {
        setBlockError(complete.error.message)
        return
      }
      setCreds(await api.listPasskeys(selected))
    } catch (error) {
      setBlockError(error instanceof Error && error.name === 'NotAllowedError' ? t('passkeyCancelled') : t('passkeyError'))
    } finally {
      setBusy(false)
    }
  }

  async function remove(credentialId: string): Promise<void> {
    if (selected === undefined || busy) return
    setBusy(true)
    setBlockError(undefined)
    const result = await api.removePasskey(selected, credentialId)
    if (result.ok) {
      setCreds(await api.listPasskeys(selected))
    } else {
      setBlockError(result.error.message)
    }
    setBusy(false)
  }

  return (
    <div data-block="passkeys" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {accounts.map((a) => (
          <Button
            key={a.username}
            data-action="passkey-account"
            data-username={a.username}
            disabled={busy}
            onClick={() => { void pick(a.username) }}
          >
            {a.username}
          </Button>
        ))}
      </div>
      {serverAvailable === false ? <p data-passkey-server-unavailable="" style={form.error}>{t('passkeyServerUnavailable')}</p> : null}
      {available ? null : <p data-webauthn-unavailable="" style={form.error}>{t('webauthnUnavailable')}</p>}
      {selected !== undefined
        ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 12px', borderRadius: '8px', border: '1px solid var(--dsw-alias-border-l2, rgba(255,255,255,0.08))' }}>
              <span style={{ fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' }}>{t('selectedAccount')}: <strong style={{ color: 'var(--dsw-alias-label-primary)' }}>{selected}</strong></span>
              <ul style={list.ul}>
                {creds.length === 0
                  ? <li style={{ color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px', padding: '4px 0' }}>{t('noPasskeys')}</li>
                  : creds.map((c) => (
                      <li key={c.credentialId} style={list.row}>
                        <code style={{ fontSize: '12px', wordBreak: 'break-all', flex: 1 }}>{c.credentialId}</code>
                        <Button data-action="passkey-remove" data-credential={c.credentialId} disabled={busy} onClick={() => { void remove(c.credentialId) }}>
                          {t('remove')}
                        </Button>
                      </li>
                    ))}
              </ul>
              <Button data-action="passkey-register" disabled={!available || serverAvailable !== true || busy} onClick={() => { void register() }}>
                {t('registerPasskey')}
              </Button>
            </div>
          )
        : <p style={form.hint}>{t('pickAccountHint')}</p>}
      {blockError !== undefined ? <p data-block-error="" style={form.error}>{blockError}</p> : null}
    </div>
  )
}

/** 保持 tree-shaking 友好的占位导出。 */
export function PasskeysPlaceholder(): ReactNode {
  return null
}
