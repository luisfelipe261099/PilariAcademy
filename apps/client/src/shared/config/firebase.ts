import { initializeApp, type FirebaseApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth'

export const hasFirebaseConfig = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
    import.meta.env.VITE_FIREBASE_PROJECT_ID &&
    import.meta.env.VITE_FIREBASE_APP_ID,
)

let app: FirebaseApp | null = null
let auth: Auth | null = null

if (hasFirebaseConfig) {
  app = initializeApp({
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  })
  auth = getAuth(app)
  // Ensaio local: login no emulador, sem tocar nas contas reais. Em produção a variável não existe.
  const emulador = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL
  if (emulador) connectAuthEmulator(auth, emulador, { disableWarnings: true })
  // E-mails transacionais do Firebase (reset de senha, verificação) saem em pt-BR.
  auth.languageCode = 'pt-BR'
  // Decisão de persistência: mantemos o padrão do Firebase (browserLocalPersistence — refresh
  // token no IndexedDB, sobrevive ao fechar a aba) para não deslogar o aluno a cada sessão.
  // O risco (XSS lendo o IndexedDB) é mitigado por: (1) sem `dangerouslySetInnerHTML`/innerHTML
  // no app; (2) CSP a ser aplicada no servidor do SPA. Reavaliar session-persistence se o
  // perfil de risco mudar.
} else {
  console.warn('⚠️ Firebase não configurado: defina VITE_FIREBASE_* em apps/client/.env')
}

export const firebaseApp = app
export const firebaseAuth = auth
