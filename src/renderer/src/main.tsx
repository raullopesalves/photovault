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
  const [{ default: App }, { ErrorBoundary, reportError }] = await Promise.all([import('./App'), import('./components/ErrorBoundary')])
  // Errors outside React's rendering (event handlers, timers, promises) are logged; the page keeps working.
  window.addEventListener('error', (e) => reportError('uncaught', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => reportError('unhandled_rejection', e.reason))
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  )
})()
