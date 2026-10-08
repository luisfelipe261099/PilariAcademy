// Mock do pacote @pilari/types para o Jest (evita carregar o dist ESM do workspace
// em ambiente CommonJS). Mantenha o enum Role em sincronia com types/src/index.ts.
export enum Role {
  student = 'student',
  teacher = 'teacher',
  admin = 'admin',
}

export interface AuthUser {
  uid: string
  email: string
  displayName: string | null
  photoUrl: string | null
  roles: Role[]
  isPlatformAdmin: boolean
}
