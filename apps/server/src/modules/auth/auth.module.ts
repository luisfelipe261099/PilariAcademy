import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { IdentityService } from './identity.service'
import { FirebaseAuthGuard } from '../../common/guards/firebase-auth.guard'

@Module({
  imports: [ConfigModule],
  controllers: [AuthController],
  providers: [
    // Inicializa o firebase-admin uma única vez: Service Account em Base64 OU ADC (Google Cloud).
    {
      provide: 'FIREBASE_ADMIN_INIT',
      useFactory: (configService: ConfigService) => {
        if (getApps().length === 0) {
          const base64 = configService.get<string>('FIREBASE_SERVICE_ACCOUNT_BASE64') || ''
          if (base64) {
            const decoded = Buffer.from(base64, 'base64').toString('utf-8')
            initializeApp({ credential: cert(JSON.parse(decoded)) })
          } else {
            initializeApp({ credential: applicationDefault() })
          }
        }
        return true
      },
      inject: [ConfigService],
    },
    AuthService,
    IdentityService,
    FirebaseAuthGuard,
  ],
  exports: [AuthService, IdentityService, FirebaseAuthGuard],
})
export class AuthModule {}
