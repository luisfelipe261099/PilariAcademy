import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/styles/index.css'
import { App } from './app'
import { iniciarApp } from './shared/lib/pwa'

// Antes do React: o convite de instalação do navegador dispara cedo e uma vez só.
iniciarApp()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
