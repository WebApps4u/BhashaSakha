import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { applyTheme, getInitialTheme } from '@/lib/theme'
import '@/lib/i18n'
import { useSettingsStore } from '@/store/settingsStore'

applyTheme(getInitialTheme())
useSettingsStore.getState().init()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
