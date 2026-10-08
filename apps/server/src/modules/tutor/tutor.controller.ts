import { Body, Controller, Get, Param, Post, Res, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Response } from 'express'
import type { TutorInfo, TutorResposta } from '@pilari/types'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'
import { Authenticated } from '../../common/decorators/authenticated.decorator'
import { CurrentUser } from '../../common/decorators/current-user.decorator'
import type { DecodedFirebaseUser } from '../../common/types/user.type'
import { CurrentTenant } from '../tenancy/current-tenant.decorator'
import type { TenantContext } from '../tenancy/tenant-context'
import { FalaTutorDto, PerguntaTutorDto } from './dto/tutor.dto'
import { TutorService } from './tutor.service'

@Controller('me/courses/:slug/tutor')
@UseGuards(FirebaseAuthGuard)
@Authenticated()
export class TutorController {
  constructor(private readonly tutor: TutorService) {}

  @Get()
  async info(@CurrentUser() u: DecodedFirebaseUser, @CurrentTenant() tenant: TenantContext, @Param('slug') slug: string): Promise<TutorInfo> {
    return this.tutor.info(tenant, u.uid, slug)
  }

  /** Corpo maior que o padrão (áudio em base64): o leitor de até 4 MB desta rota está em tutor-body-parser.ts. */
  @Post('ask')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async ask(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('slug') slug: string,
    @Body() dto: PerguntaTutorDto
  ): Promise<TutorResposta> {
    return this.tutor.perguntar(tenant, u.uid, slug, dto)
  }

  /** PCM 16 bits mono 24 kHz em fluxo (chunked): o navegador toca os pedaços à medida que chegam. */
  @Post('speak')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async speak(
    @CurrentUser() u: DecodedFirebaseUser,
    @CurrentTenant() tenant: TenantContext,
    @Param('slug') slug: string,
    @Body() dto: FalaTutorDto,
    @Res() res: Response
  ): Promise<void> {
    const parar = new AbortController()
    res.on('close', () => {
      if (!res.writableFinished) parar.abort()
    })
    let comecou = false
    try {
      await this.tutor.falar(
        tenant,
        u.uid,
        slug,
        dto.texto,
        (pcm) => {
          if (!comecou) {
            comecou = true
            res.status(200)
            res.setHeader('Content-Type', 'audio/l16; rate=24000; channels=1')
            res.setHeader('Cache-Control', 'no-store')
            res.setHeader('X-Accel-Buffering', 'no')
            res.flushHeaders()
          }
          res.write(pcm)
        },
        parar.signal
      )
    } catch (err) {
      // Antes do primeiro pedaço, o erro vira a resposta JSON normal (o filtro de exceções do Nest cuida). Depois,
      // os cabeçalhos já saíram: só dá para encerrar o fluxo.
      if (!comecou) throw err
    }
    if (!comecou) res.status(204)
    res.end()
  }
}
