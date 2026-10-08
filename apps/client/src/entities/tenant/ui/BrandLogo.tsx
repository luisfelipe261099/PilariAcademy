import { PilariLogo } from '@/shared/ui'
import { useTenant } from '../queries'

// A logo de polo é de qualquer proporção (600x100, por exemplo): quando o espaço do cabeçalho acaba, ela
// encolhe dentro da caixa, alinhada à esquerda, em vez de empurrar o resto para fora da tela.
const CABE = 'max-w-full object-contain object-left'

/**
 * Logo do polo do endereço. A matriz sem logo enviada usa a logo do Studio Pilari (símbolo + nome em texto,
 * que já acompanha o tema escuro). Com versão para o tema escuro, troca por CSS; sem ela, a matriz fica branca
 * por filtro e o polo mostra a logo como veio, porque o filtro transformaria uma logo colorida ou um JPEG num
 * borrão branco. Polo sem logo: o nome, numa linha só e cortado com reticências quando não cabe (a altura da
 * linha, `leading-9`, é a do cabeçalho).
 */
export function BrandLogo({ className }: { className: string }) {
  const t = useTenant()
  const { logoUrl, logoLightUrl } = t.branding
  if (t.isMatriz && !logoUrl) return <PilariLogo className={className} />
  if (!logoUrl) return <span className={`${className} block max-w-full truncate leading-9 text-lg font-bold text-accent`}>{t.name}</span>
  if (logoLightUrl) {
    return (
      <>
        <img src={logoUrl} alt={t.name} className={`${className} ${CABE} dark:hidden`} />
        <img src={logoLightUrl} alt={t.name} className={`${className} ${CABE} hidden dark:block`} />
      </>
    )
  }
  return <img src={logoUrl} alt={t.name} className={t.isMatriz ? `${className} dark:brightness-0 dark:invert` : `${className} ${CABE}`} />
}
