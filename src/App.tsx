import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from '@/components/AppShell'
import Auth from '@/pages/Auth'
import Dashboard from '@/pages/Dashboard'
import Session from '@/pages/Session'
import SharedSession from '@/pages/SharedSession'
import Live from '@/pages/Live'
import Account from '@/pages/Account'

function NotFound() {
  return <div className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">Page not found.</div>
}

export default function App() {
  return (
    <Router>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<Navigate to="/live" replace />} />
          <Route path="/live" element={<Live />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/login" element={<Auth />} />
          <Route path="/account" element={<Account />} />
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
