import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { getAuth } from 'firebase-admin/auth'

/** Centraliza todas as chamadas ao Firebase Admin SDK (verificar token, achar e criar conta, reset de senha, etc.). */
@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name)

  constructor(private readonly config: ConfigService) {}

  /** Verifica e decodifica o ID token vindo do cliente. checkRevoked detecta logout/ban server-side. */
  async verifyIdToken(token: string, checkRevoked = true) {
    return getAuth().verifyIdToken(token, checkRevoked)
  }

  /** Lê os dados do usuário direto do Firebase (displayName, photoURL, etc.). */
  async getFirebaseUser(uid: string) {
    return getAuth().getUser(uid)
  }

  /**
   * A conta já entrou alguma vez? O Firebase só preenche o último login (metadata.lastSignInTime) depois do primeiro.
   * Erro do Firebase sobe: quem chama decide o que fazer na dúvida.
   */
  async hasSignedIn(uid: string): Promise<boolean> {
    const user = await getAuth().getUser(uid)
    return !!user.metadata?.lastSignInTime
  }

  /** uid da conta Firebase com este e-mail, ou null se não existe. */
  async findUidByEmail(email: string): Promise<string | null> {
    try {
      return (await getAuth().getUserByEmail(email)).uid
    } catch (error) {
      if ((error as { code?: string } | null)?.code === 'auth/user-not-found') return null
      throw this.mapFirebaseAuthError(error)
    }
  }

  /** Cria a conta no Firebase. Papéis NÃO vão em claims: valem por polo e moram no banco. */
  async createIdentity(email: string, displayName: string, password: string): Promise<string> {
    try {
      const user = await getAuth().createUser({ email, displayName, password, emailVerified: true })
      return user.uid
    } catch (error) {
      throw this.mapFirebaseAuthError(error)
    }
  }

  async updateUser(uid: string, props: { disabled?: boolean; password?: string }) {
    await getAuth().updateUser(uid, props)
  }

  /**
   * Pede ao Firebase que envie ao TITULAR o e-mail com o link de redefinição de senha.
   * Usa o endpoint accounts:sendOobCode com a web API key (a mesma pública do client) —
   * é o que o sendPasswordResetEmail do SDK de browser faz; o Admin SDK só gera o link
   * (generatePasswordResetLink) e não envia e-mail, e não temos SMTP próprio.
   * Ninguém além do titular vê o link — nem o admin que disparou (A07).
   */
  async sendPasswordResetEmail(email: string): Promise<void> {
    const key = this.config.get<string>('FIREBASE_WEB_API_KEY')
    if (!key) {
      this.logger.error('FIREBASE_WEB_API_KEY não configurada — reset de senha indisponível.')
      throw new InternalServerErrorException('Envio de e-mail de redefinição não configurado.')
    }
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
    })
    if (!res.ok) {
      // Loga só o código do erro (EMAIL_NOT_FOUND etc.) — nunca o e-mail (PII) nem a resposta inteira.
      const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
      this.logger.error(`sendOobCode falhou (${res.status}): ${json?.error?.message ?? 'sem código'}`)
      throw new BadRequestException('Não foi possível enviar o link de redefinição.')
    }
  }

  async revokeTokens(uid: string) {
    await getAuth().revokeRefreshTokens(uid)
  }

  async deleteIdentity(uid: string) {
    await getAuth().deleteUser(uid)
  }

  private mapFirebaseAuthError(error: unknown): Error {
    const code = (error as { code?: string } | null)?.code
    switch (code) {
      case 'auth/email-already-exists':
        return new ConflictException('Já existe um usuário com este e-mail.')
      case 'auth/invalid-email':
        return new BadRequestException('O e-mail informado é inválido.')
      case 'auth/invalid-password':
      case 'auth/password-does-not-meet-requirements':
        return new BadRequestException('A senha não atende aos requisitos de segurança.')
      default:
        return error instanceof Error ? error : new Error('Erro no provedor de autenticação.')
    }
  }
}
