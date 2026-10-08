import { Controller, Get, Logger, NotFoundException, Param, Query, Res } from '@nestjs/common'
import type { Response } from 'express'
import type { Readable } from 'node:stream'
import { Public } from '../../common/decorators/public.decorator'
import { FileProxyService } from './file-proxy.service'

/**
 * Serve o PDF do anexo pelo domínio do app. @Public() porque <iframe> não manda header de
 * Authorization — a AUTORIZAÇÃO real é o token HMAC na query (capability URL com expiração),
 * gerado só para anexos de curso a que o aluno tem acesso (ClassroomService). Fica sob /api
 * para não ser engolida pelo fallback do SPA.
 */
@Controller('files')
export class FileProxyController {
  private readonly logger = new Logger(FileProxyController.name)

  constructor(private readonly fileProxy: FileProxyService) {}

  /** O PDF segue em stream do GCS para a resposta: nunca inteiro na memória. */
  @Public()
  @Get('attachments/:id/pdf')
  async attachmentPdf(
    @Param('id') id: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response
  ): Promise<void> {
    const pdf = await this.fileProxy.getSignedPdf(id, Number(exp), sig ?? '')
    if (!pdf) throw new NotFoundException('PDF indisponível.')

    const safeName = pdf.fileName.replace(/["\r\n]/g, '')
    // Sempre application/pdf: o service já garante que só chega aqui um PDF de verdade. Cravar o
    // tipo aqui também impede que qualquer regressão futura reflita um content-type do usuário
    // com disposição inline na origem do app (Stored XSS).
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${safeName}"`)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    this.transmitir(id, pdf.stream, res)
  }

  /**
   * Repassa o stream do GCS para a resposta, com os dois cuidados que o pipe do Nest (StreamableFile) não tem:
   * - quem desiste no meio fecha a conexão, e o stream do GCS é destruído junto (o `pipe` só desconecta a origem, e a
   *   conexão com o bucket ficaria aberta, presa na memória);
   * - falha da origem depois do primeiro byte derruba a conexão: encerrar a resposta normalmente entregaria um PDF
   *   truncado como um 200 completo, e o navegador o guardaria no cache. Antes do primeiro byte, 404 que não vai para o
   *   cache. A mensagem do GCS vai só para o log.
   */
  private transmitir(id: string, fonte: Readable, res: Response): void {
    res.on('close', () => {
      if (!res.writableFinished) fonte.destroy()
    })
    fonte.on('error', (err) => {
      this.logger.error(`Falha ao transmitir o PDF do anexo ${id}: ${err.message}`)
      if (res.destroyed) return
      if (res.headersSent) {
        res.destroy(err)
        return
      }
      res.removeHeader('Content-Disposition')
      res.setHeader('Cache-Control', 'no-store')
      res.status(404).type('text/plain').send('PDF indisponível.')
    })
    fonte.pipe(res)
  }
}
