import { Link } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useTranslation } from 'react-i18next'
import { UI_LOCALES, type UiLocale } from '@/lib/i18n'
import { useSettingsStore } from '@/store/settingsStore'

export default function Account() {
  const { t } = useTranslation()
  const { user, isReady } = useAuthStore()
  const uiLocale = useSettingsStore((s) => s.uiLocale)
  const setUiLocale = useSettingsStore((s) => s.setUiLocale)

  if (!isReady) {
    return <div className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-white/10" />
  }

  if (!user) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-white/5">
        <div className="text-sm text-slate-700 dark:text-slate-200">{t('auth.signInToManage')}</div>
        <div className="mt-3">
          <Link to="/login" className="text-sm font-medium text-slate-900 underline dark:text-slate-50">
            {t('auth.goToLogin')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
        <h1 className="text-lg font-semibold">{t('account.title')}</h1>
        <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {t('auth.signedInAs')} {user.email ?? user.id}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
        <div className="text-sm font-semibold">{t('settings.title')}</div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-1 text-xs text-slate-600 dark:text-slate-300">
            {t('settings.uiLanguage')}
            <select
              value={uiLocale}
              onChange={(e) => setUiLocale(e.target.value as UiLocale)}
              className="h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-50"
            >
              {UI_LOCALES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
          <div className="text-sm font-semibold">{t('account.plan')}</div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('account.planHint')}</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-white/10 dark:bg-white/5">
          <div className="text-sm font-semibold">{t('account.integrations')}</div>
          <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">{t('account.integrationsHint')}</div>
        </div>
      </div>
    </div>
  )
}
