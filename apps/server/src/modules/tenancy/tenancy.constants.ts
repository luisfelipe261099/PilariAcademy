/** Id fixo do polo matriz (o Studio Pilari). Gravado na migration 0034. */
export const MATRIZ_TENANT_ID = 'accbdc75-009f-4aa2-9fd3-e92d11f3b06d'

/** Domínio base dos sites de polo: <slug>.cursos.studiopilari.com.br. */
export const DEFAULT_TENANT_BASE_DOMAIN = 'cursos.studiopilari.com.br'

/** Subdomínios que nunca viram polo: infraestrutura, institucionais ou ambíguos. */
export const RESERVED_TENANT_SLUGS: ReadonlySet<string> = new Set([
  'www', 'api', 'admin', 'app', 'assets', 'auth', 'cdn', 'cursos', 'dev', 'email', 'pilari',
  'ftp', 'login', 'mail', 'plataforma', 'smtp', 'studiopilari', 'staging', 'static', 'status',
  'suporte', 'test',
])

/** 3 a 40 caracteres: minúsculas, dígitos e hífen, sem hífen nas pontas. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/
