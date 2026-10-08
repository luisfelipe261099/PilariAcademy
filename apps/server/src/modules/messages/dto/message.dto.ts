import { IsString, MaxLength, MinLength } from 'class-validator'

export class SendMessageDto {
  @IsString()
  @MinLength(1, { message: 'A mensagem não pode ficar vazia.' })
  @MaxLength(2000, { message: 'A mensagem é muito longa.' })
  body!: string
}
