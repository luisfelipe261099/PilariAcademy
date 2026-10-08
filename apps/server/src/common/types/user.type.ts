import { Role } from '@pilari/types'

/** Usuário decodificado do ID token e populado em `request.user` pelo FirebaseAuthGuard. */
export type DecodedFirebaseUser = {
  uid: string
  email?: string
  /** Papéis EFETIVOS no polo do endereço (inclui `admin` para admin da plataforma). */
  roles?: Role[]
  /** Admin da plataforma EFETIVO: o sinal do cadastro ou o admin da matriz (B10). */
  isPlatformAdmin?: boolean
}
