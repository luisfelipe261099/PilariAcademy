import { IsIn, IsObject, IsString, Length } from 'class-validator'
import type { BrandingAssetKind, TenantBrandingInput } from '@pilari/types'
import { BRANDING_UPLOAD_TYPES } from '../../tenancy/branding-upload'

// Toda regra daqui declara a própria mensagem, em português (B5): o texto padrão do class-validator é em inglês e iria
// direto para a Minha escola e para o console. O tenant-site.dto.spec confere regra por regra.

export class UpdateMyTenantDto {
  /** Campos da marca a alterar. Cada campo é validado pelo mergeBranding. */
  @IsObject({ message: 'Marca do polo inválida.' }) branding!: TenantBrandingInput
}

export class BrandingUploadDto {
  @IsIn(['logo', 'logo-light', 'favicon'], { message: 'Tipo de imagem inválido: use logo, logo-light ou favicon.' }) kind!: BrandingAssetKind
  @IsString({ message: 'Informe o nome do arquivo.' })
  @Length(1, 200, { message: 'Informe o nome do arquivo (1 a 200 caracteres).' })
  fileName!: string
  @IsIn(BRANDING_UPLOAD_TYPES, { message: 'Envie a imagem em PNG, JPEG ou WebP.' }) contentType!: string
}
