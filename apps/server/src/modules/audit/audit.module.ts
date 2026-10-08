import { Global, Module } from '@nestjs/common'
import { AuditService } from './audit.service'

/** Global: AuditService fica injetável em qualquer controller sem reimportar. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
