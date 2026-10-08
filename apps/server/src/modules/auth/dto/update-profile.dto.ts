import { IsOptional, IsString, IsUrl, MaxLength, ValidateIf } from 'class-validator'

export class UpdateProfileDto {
  // Aceita com ou sem máscara; o service normaliza e só grava se estiver vazio (write-once).
  @IsOptional()
  @IsString()
  @MaxLength(14)
  cpf?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  displayName?: string

  // Só http(s): evita `javascript:`/`data:` guardados e depois renderizados como avatar.
  // ValidateIf deixa passar a string vazia (limpar a foto).
  @IsOptional()
  @ValidateIf((o: UpdateProfileDto) => o.photoUrl !== '')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(1024)
  photoUrl?: string

  @IsOptional()
  @IsString()
  @MaxLength(255)
  headline?: string

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  bio?: string
}
