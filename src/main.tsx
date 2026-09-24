import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { listenForInstallPrompt } from './lib/installPrompt'

// Before anything renders: the browser offers the install prompt only once, and early.
listenForInstallPrompt()

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: String(error) };
  }
  render() {
    if (this.state.hasError) {
      return (
        // Styled from the theme tokens like everything else: the stylesheet is
        // the one thing still standing when the app itself is not.
        <div style={{ minHeight: '100vh', background: 'var(--app-bg)', color: 'var(--ink)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '2rem', fontFamily: 'sans-serif' }}>
          <h2 style={{ color: 'var(--danger-text)', marginBottom: '1rem' }}>App Error — Please Reload</h2>
          <pre style={{ background: 'var(--card)', padding: '1rem', borderRadius: '8px', fontSize: '12px', maxWidth: '640px', overflowX: 'auto', whiteSpace: 'pre-wrap', color: 'var(--ink-3)', border: '1px solid var(--line)' }}>
            {this.state.error}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: '1.5rem', padding: '10px 24px', background: 'var(--accent-strong)', color: 'var(--accent-ink)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}
          >
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Local-only fetch mock (see src/mocktmp.ts) so the dashboard can be previewed with
// `npm run dev` and no PHP backend. Only ever loaded on localhost, and silently
// skipped if the file isn't there, so it can never affect a real deployment. Awaited
// before the app renders so the very first fetch is already mocked.
async function bootstrap() {
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    // Built from a variable, not a literal, so neither tsc nor Vite's bundler try to
    // resolve this file at build time — it's fine if it doesn't exist (e.g. in prod).
    const mockModulePath = './mocktmp.ts';
    await import(/* @vite-ignore */ mockModulePath).catch(() => {});
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  )
}

bootstrap()
