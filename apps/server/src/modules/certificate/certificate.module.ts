import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { QuizModule } from '../quiz/quiz.module'
import { EnrollmentsModule } from '../enrollments/enrollments.module'
import { GcsService } from '../classroom/gcs.service'
import { PdfService } from './pdf.service'
import { CertificateService } from './certificate.service'
import { CertificateTemplateService } from './certificate-template.service'
import { CertificateController } from './certificate.controller'
import { CertificateTemplateController } from './certificate-template.controller'

@Module({
  // EnrollmentsModule: fornece InstallmentsService (contagem de parcelas) e AsaasService
  // (proxy do carnê) usados pelo gate de quitação do certificado.
  imports: [AuthModule, QuizModule, EnrollmentsModule],
  controllers: [CertificateController, CertificateTemplateController],
  providers: [PdfService, CertificateService, CertificateTemplateService, GcsService],
})
export class CertificateModule {}
