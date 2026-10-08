import { ArrayNotEmpty, IsArray, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator'

/** Preview do editor: HTML solto, sem template salvo ainda. */
export class SaveTemplateDto {
  @IsString() @IsNotEmpty() html!: string
}

export class CreateTemplateDto {
  @IsString() @IsNotEmpty() @MaxLength(120) name!: string
  @IsString() @IsNotEmpty() html!: string
}

export class UpdateTemplateDto {
  @IsOptional() @IsString() @IsNotEmpty() @MaxLength(120) name?: string
  @IsOptional() @IsString() @IsNotEmpty() html?: string
}

/**
 * Vincula cursos a um template. `templateId` nulo devolve os cursos ao padrão — é como a
 * tela desfaz um vínculo sem precisar de uma rota separada só para isso.
 */
export class AssignTemplateDto {
  @IsOptional() @IsString() templateId?: string | null
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) courseIds!: string[]
}
