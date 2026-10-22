import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { setLanguage } from './lib/i18n'
import '@fontsource-variable/schibsted-grotesk'
import '@fontsource/fragment-mono'
import './styles.css'

// The language is set before the app's modules load, so their labels are created in it.
void (async () => {
  try {
    setLanguage((await window.photoVault.getSettings()).language)
  } catch {
    setLanguage('en')
  }
  const { default: App } = await import('./App')
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
})()
