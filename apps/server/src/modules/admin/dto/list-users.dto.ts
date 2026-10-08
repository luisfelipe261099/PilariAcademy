import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'

/**
 * Query params da listagem de usuários. Todos opcionais: sem `page`/`pageSize` a lista
 * volta inteira (dropdowns/telas que precisam de todos); com eles, pagina.
 * A conversão string→number vem do ValidationPipe global (enableImplicitConversion).
 */
export class ListUsersDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number

  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string
}
