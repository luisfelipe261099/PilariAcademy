/** Traduz códigos de erro do Firebase Auth para mensagens em pt-BR. */
export function mapAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'E-mail ou senha incorretos.'
    case 'auth/email-already-in-use':
      return 'Este e-mail já está cadastrado. Tente entrar.'
    case 'auth/weak-password':
      return 'A senha deve ter pelo menos 6 caracteres.'
    case 'auth/invalid-email':
      return 'E-mail inválido.'
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde um momento e tente de novo.'
    case 'auth/network-request-failed':
      return 'Falha de rede. Verifique sua conexão.'
    default:
      return 'Não foi possível concluir. Tente novamente.'
  }
}
