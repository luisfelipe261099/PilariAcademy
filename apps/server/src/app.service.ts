import { Injectable } from '@nestjs/common'
import { APP_NAME, type ApiMessage } from '@pilari/types'

@Injectable()
export class AppService {
  getHello(): ApiMessage {
    return {
      message: `Olá do servidor ${APP_NAME} 👋`,
      timestamp: new Date().toISOString(),
    }
  }
}
