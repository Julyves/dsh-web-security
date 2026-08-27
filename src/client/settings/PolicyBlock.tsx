/**
 * 安全策略区块：六字段表单 + 脏字段保存 + 降级二次确认。
 *
 * 保存模型（grill-me Q8-A）：本地草稿 vs settingsRead 快照逐字段 diff →
 * 只提交脏字段 Partial；未改动时保存禁用。降级方向变更（关审计/放宽限速/
 * 延长会话/关登录方式）经 RiskConfirmation 二次确认后提交。自锁死与区间
 * 校验在 host——UI 只呈现 host 错误（单一权威源）。
 */
import { useEffect, useState } from 'react'
import type { FC } from 'react'
import { Button, Input, RiskConfirmation } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Envelope } from './AccountsBlock.tsx'

/** 安全设置视图（SecuritySettings 的可变 UI 草稿镜像）。 */
export interface SecuritySettingsView {
  passwordLogin: boolean
  passkeyLogin: boolean
  sessionTtlMinutes: number
  maxLoginAttempts: number
  rateLimitWindowMinutes: number
  auditEnabled: boolean
}

/** 策略区块注入面。 */
export interface PolicyApi {
  readSettings(): Promise<SecuritySettingsView>
  writeSettings(partial: Partial<SecuritySettingsView>): Promise<Envelope<SecuritySettingsView>>
}

/** 数值字段名。 */
type NumberField = 'sessionTtlMinutes' | 'maxLoginAttempts' | 'rateLimitWindowMinutes'

/** 降级方向判定：变更是否削弱安全姿态。 */
function isDowngrade(field: NumberField | 'passwordLogin' | 'passkeyLogin' | 'auditEnabled', before: unknown, after: unknown): boolean {
  switch (field) {
    case 'auditEnabled': return before === true && after === false
    case 'passwordLogin': return before === true && after === false
    case 'passkeyLogin': return before === true && after === false
    case 'sessionTtlMinutes': return (after as number) > (before as number)
    case 'maxLoginAttempts': return (after as number) > (before as number)
    case 'rateLimitWindowMinutes': return (after as number) < (before as number)
    default: return false
  }
}

/** 脏字段收集（数值比较归一 string→number）。 */
function dirtyFieldsOf(before: SecuritySettingsView, after: SecuritySettingsView): Partial<SecuritySettingsView> {
  const dirty: Partial<SecuritySettingsView> = {}
  for (const f of ['passwordLogin', 'passkeyLogin', 'auditEnabled'] as const) {
    if (after[f] !== before[f]) dirty[f] = after[f]
  }
  for (const f of ['sessionTtlMinutes', 'maxLoginAttempts', 'rateLimitWindowMinutes'] as const) {
    if (Number(after[f]) !== before[f]) dirty[f] = Number(after[f])
  }
  return dirty
}

/** 策略区块 props。 */
export interface PolicyBlockProps {
  t: (key: string) => string
  api: PolicyApi
}

/** 安全策略区块组件。 */
export const PolicyBlock: FC<PolicyBlockProps> = ({ t, api }) => {
  const [snapshot, setSnapshot] = useState<SecuritySettingsView | undefined>(undefined)
  const [draft, setDraft] = useState<SecuritySettingsView | undefined>(undefined)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const [pendingSave, setPendingSave] = useState<Partial<SecuritySettingsView> | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    api.readSettings()
      .then((s) => { if (!cancelled) { setSnapshot(s); setDraft(s); setState('ready') } })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [api])

  if (snapshot === undefined || draft === undefined) {
    return <div data-block="policy" data-state={state}>{state === 'error' ? <p data-error="">{t('loadFailed')}</p> : null}</div>
  }

  const dirty = dirtyFieldsOf(snapshot, draft)
  const hasDirty = Object.keys(dirty).length > 0
  const downgrade = Object.entries(dirty).some(([f, v]) =>
    isDowngrade(f as keyof SecuritySettingsView, snapshot[f as keyof SecuritySettingsView], v))

  async function submit(partial: Partial<SecuritySettingsView>): Promise<void> {
    if (saving) return
    setSaving(true)
    setSaveError(undefined)
    const result = await api.writeSettings(partial)
    if (result.ok) {
      setSnapshot(result.value)
      setDraft(result.value)
      setPendingSave(undefined)
    } else {
      setSaveError(result.error.message)
      setPendingSave(undefined)
    }
    setSaving(false)
  }

  return (
    <div data-block="policy" data-state={state}>
      <label>
        <span>{t('fieldPasswordLogin')}</span>
        <input
          data-field="passwordLogin"
          type="checkbox"
          checked={draft.passwordLogin}
          onChange={(e) => setDraft({ ...draft, passwordLogin: e.target.checked })}
        />
      </label>
      <label>
        <span>{t('fieldPasskeyLogin')}</span>
        <input
          data-field="passkeyLogin"
          type="checkbox"
          checked={draft.passkeyLogin}
          onChange={(e) => setDraft({ ...draft, passkeyLogin: e.target.checked })}
        />
      </label>
      <label>
        <span>{t('fieldAuditEnabled')}</span>
        <input
          data-field="auditEnabled"
          type="checkbox"
          checked={draft.auditEnabled}
          onChange={(e) => setDraft({ ...draft, auditEnabled: e.target.checked })}
        />
      </label>
      <label>
        <span>{t('fieldSessionTtl')}</span>
        <Input
          data-field="sessionTtlMinutes"
          value={String(draft.sessionTtlMinutes)}
          onChange={(v) => setDraft({ ...draft, sessionTtlMinutes: Number(v) })}
          type="number"
        />
      </label>
      <label>
        <span>{t('fieldMaxAttempts')}</span>
        <Input
          data-field="maxLoginAttempts"
          value={String(draft.maxLoginAttempts)}
          onChange={(v) => setDraft({ ...draft, maxLoginAttempts: Number(v) })}
          type="number"
        />
      </label>
      <label>
        <span>{t('fieldRateWindow')}</span>
        <Input
          data-field="rateLimitWindowMinutes"
          value={String(draft.rateLimitWindowMinutes)}
          onChange={(v) => setDraft({ ...draft, rateLimitWindowMinutes: Number(v) })}
          type="number"
        />
      </label>
      {saveError !== undefined ? <p data-save-error="">{saveError}</p> : null}
      {pendingSave !== undefined
        ? (
            <RiskConfirmation
              confirm={() => { void submit(pendingSave) }}
              cancel={() => setPendingSave(undefined)}
            >
              {t('downgradeConfirm')}
            </RiskConfirmation>
          )
        : null}
      <Button
        data-action="policy-save"
        disabled={!hasDirty || saving}
        onClick={() => { if (downgrade) setPendingSave(dirty); else void submit(dirty) }}
      >
        {t('save')}
      </Button>
    </div>
  )
}
