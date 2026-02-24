import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import Auth from '@/pages/Auth'
import Dashboard from '@/pages/Dashboard'
import Session from '@/pages/Session'
import SharedSession from '@/pages/SharedSession'
import Live from '@/pages/Live'
import Account from '@/pages/Account'
import Usage from '@/pages/Usage'
import Models from '@/pages/Models'
import AdminShell from '@/components/admin/AdminShell'
import AdminHome from '@/pages/admin/AdminHome'
import AdminUsers from '@/pages/admin/AdminUsers'
import AdminSettings from '@/pages/admin/AdminSettings'
import AdminFlags from '@/pages/admin/AdminFlags'
import AdminLogs from '@/pages/admin/AdminLogs'
import AdminPlans from '@/pages/admin/AdminPlans'
import AdminUsage from '@/pages/admin/AdminUsage'
import AdminAIProviders from '@/pages/admin/AdminAIProviders'
import AdminAIModels from '@/pages/admin/AdminAIModels'
import AdminAIRouting from '@/pages/admin/AdminAIRouting'
import AdminAIEntitlements from '@/pages/admin/AdminAIEntitlements'
import Setup from '@/pages/Setup'
import { isSupabaseConfigured, supabaseConfigError } from '@/lib/supabaseClient'

function NotFound() {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600 dark:border-white/10 dark:bg-white/5 dark:text-slate-300">
      Page not found.
    </div>
  )
}

export default function App() {
  if (!isSupabaseConfigured) {
    return <Setup error={supabaseConfigError} />
  }

  return (
    <Router>
      <Routes>
        <Route path="/admin" element={<AdminShell />}>
          <Route index element={<AdminHome />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="plans" element={<AdminPlans />} />
          <Route path="usage" element={<AdminUsage />} />
          <Route path="ai/providers" element={<AdminAIProviders />} />
          <Route path="ai/models" element={<AdminAIModels />} />
          <Route path="ai/routing" element={<AdminAIRouting />} />
          <Route path="ai/entitlements" element={<AdminAIEntitlements />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="flags" element={<AdminFlags />} />
          <Route path="logs" element={<AdminLogs />} />
        </Route>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/live" replace />} />
          <Route path="/live" element={<Live />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/account" element={<Account />} />
          <Route path="/usage" element={<Usage />} />
          <Route path="/models" element={<Models />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/session/:sessionId" element={<Session />} />
          <Route path="/s/:shareId" element={<SharedSession />} />
          <Route path="/other" element={<Navigate to="/" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Router>
  )
}
