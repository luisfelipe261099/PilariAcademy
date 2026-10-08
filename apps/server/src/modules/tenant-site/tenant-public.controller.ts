import { Controller, Get, NotFoundException, Param, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { PublicTenant } from '@pilari/types'
import { Public } from '../../common/decorators/public.decorator'
import { resolveImageResponse } from '../../common/lib/content-safety'
import { GcsService, MAX_IMAGE_BYTES } from '../classroom/gcs.service'
import { ASSET_FIELD_BY_KIND, isAllowedBrandingUrl, isBrandingAssetKind } from '../tenancy/branding'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import { toPublicTenant } from '../tenancy/public-tenant'
import type { TenantContext } from '../tenancy/tenant-context'
import { AppIconService } from './app-icon.service'
import { ehVarianteIcone, ICONES_DA_MATRIZ, montarManifesto } from './app-manifest'

@Controller('tenant')
export class TenantPublicController {
  constructor(
    private readonly gcs: GcsService,
    private readonly icones: AppIconService
  ) {}

  /** O polo do endereço. O index.html já traz este mesmo objeto; esta rota serve o dev do Vite. */
  @Public()
  @Get()
  get(@CurrentTenant() tenant: TenantContext): PublicTenant {
    return toPublicTenant(tenant)
  }

  /** Logo, logo do tema escuro e favicon do polo. URL externa redireciona; objeto do bucket é servido. */
  @Public()
  @Get('assets/:kind')
  async asset(
    @CurrentTenant() tenant: TenantContext,
    @Param('kind') kind: string,
    @Query('v') versao: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    if (!isBrandingAssetKind(kind)) throw new NotFoundException('Imagem não encontrada.')
    const valor = tenant.branding[ASSET_FIELD_BY_KIND[kind]]
    if (!valor) throw new NotFoundException('Imagem não encontrada.')
    if (/^https?:\/\//i.test(valor)) {
      res.set('Cache-Control', 'public, max-age=3600')
      res.redirect(302, valor)
      return
    }
    // Só lê objeto da pasta da marca do PRÓPRIO polo. O `mergeBranding` já barra caminho alheio ao gravar, mas um
    // valor que chegue por outro caminho não pode abrir, com a service account, objeto de outro polo ou de um curso.
    if (!isAllowedBrandingUrl(valor, tenant.id)) throw new NotFoundException('Imagem não encontrada.')
    const obj = await this.gcs.readObject(valor, { maxBytes: MAX_IMAGE_BYTES })
    if (!obj) throw new NotFoundException('Imagem não encontrada.')
    // Mesma defesa da capa do curso: só tipos de imagem inertes saem inline na origem do app.
    const seguro = resolveImageResponse(obj.contentType)
    res.set('Content-Type', seguro.contentType)
    if (!seguro.inline) res.set('Content-Disposition', 'attachment')
    // A URL pública leva ?v=<versão do polo>: trocar a marca muda a URL, então com a versão atual o cache pode ser
    // longo. Sem ela (ou com uma velha) quem pediu não tem como saber que a imagem mudou: só um minuto.
    const versionada = versao === String(tenant.updatedAt.getTime())
    res.set('Cache-Control', versionada ? 'public, max-age=604800' : 'public, max-age=60')
    res.send(obj.buffer)
  }

  /** Manifesto do app (PWA) do polo do endereço: o aluno instala o app com o nome, a cor e o ícone do polo. */
  @Public()
  @Get('manifest')
  manifesto(@CurrentTenant() tenant: TenantContext, @Res() res: Response): void {
    res.set('Content-Type', 'application/manifest+json; charset=utf-8')
    // Muda junto com a marca: sempre revalida (é pequeno).
    res.set('Cache-Control', 'no-cache')
    res.send(JSON.stringify(montarManifesto(toPublicTenant(tenant), String(tenant.updatedAt.getTime()))))
  }

  /** Ícone do app: a matriz usa os PNGs fixos do "F"; o polo, o desenhado da marca dele. */
  @Public()
  @Get('app-icon/:variante')
  async iconeDoApp(
    @CurrentTenant() tenant: TenantContext,
    @Param('variante') variante: string,
    @Query('v') versao: string | undefined,
    @Res() res: Response
  ): Promise<void> {
    if (!ehVarianteIcone(variante)) throw new NotFoundException('Ícone não encontrado.')
    if (tenant.isMatriz) {
      res.set('Cache-Control', 'public, max-age=86400')
      res.redirect(302, ICONES_DA_MATRIZ[variante])
      return
    }
    const png = await this.icones.doPolo(tenant, variante)
    res.set('Content-Type', 'image/png')
    const versionada = versao === String(tenant.updatedAt.getTime())
    res.set('Cache-Control', versionada ? 'public, max-age=604800' : 'public, max-age=300')
    res.send(png)
  }
}
