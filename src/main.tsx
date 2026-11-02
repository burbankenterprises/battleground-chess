import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { useGameStore } from './game/store.ts'

// Test hook: the e2e harness drives the same tap pipeline the board uses
// (handleTap) through this handle. Harmless in production (no secrets).
declare global {
  interface Window {
    __bgcStore?: typeof useGameStore
  }
}
window.__bgcStore = useGameStore

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
