import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator'
import type { CourseStatus } from '@pilari/types'
import { ALLOWED_UPLOAD_CONTENT_TYPES } from '../../../common/lib/content-safety'

export class CreateCourseDto {
  @IsString() @IsNotEmpty() title!: string
  @IsOptional() @IsString() subtitle?: string
  @IsOptional() @IsString() description?: string
  @IsOptional() @IsString() categoryId?: string
  @IsOptional() @IsInt() @Min(0) priceInCents?: number
}

export class UpdateCourseDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() subtitle?: string | null
  @IsOptional() @IsString() description?: string | null
  @IsOptional() @IsString() categoryId?: string | null
  @IsOptional() @IsInt() @Min(0) priceInCents?: number
  @IsOptional() @IsInt() @Min(0) promoPriceInCents?: number | null
  @IsOptional() @IsString() promoEndsAt?: string | null
  @IsOptional() @IsString() coverImageUrl?: string | null
  @IsOptional() @IsString() coverFocus?: string | null
  @IsOptional() @IsString() availableAt?: string | null
  // 2a assinatura do certificado. Só admin altera (ver updateMeta) — é documento oficial.
  @IsOptional() @IsString() @MaxLength(120) coordinatorName?: string | null
  @IsOptional() @IsString() @MaxLength(120) coordinatorRole?: string | null
  @IsOptional() @IsString() @MaxLength(1024) coordinatorSignaturePath?: string | null
  // Teto de 10.000h: acima disso é dedo escorregando, não carga horária.
  @IsOptional() @IsInt() @Min(1) @Max(10000) workloadHours?: number | null
  // Tutor de voz com IA. Só admin altera (custo por pergunta); o service ignora para instrutor.
  @IsOptional() @IsBoolean() tutorEnabled?: boolean
}

export class SetStatusDto {
  @IsIn(['draft', 'in_review', 'published', 'archived']) status!: CourseStatus
}

export class SetReleaseDto {
  @IsOptional() @IsString() availableAt?: string | null
}

export class TitleDto {
  @IsString() @IsNotEmpty() title!: string
}

export class UpdateLessonDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() description?: string | null
  @IsOptional() @IsString() videoUrl?: string | null
  @IsOptional() @IsInt() @Min(0) durationSec?: number
  @IsOptional() @IsBoolean() isFreePreview?: boolean
}

export class ReorderDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) orderedIds!: string[]
}

export class AddAttachmentDto {
  @IsString() @IsNotEmpty() fileName!: string
  @IsString() @IsNotEmpty() fileUrl!: string
}

export class UploadUrlDto {
  @IsIn(['video', 'cover', 'attachment', 'signature']) kind!: 'video' | 'cover' | 'attachment' | 'signature'
  @IsString() @IsNotEmpty() courseId!: string
  @IsString() @IsNotEmpty() fileName!: string
  // Allowlist: bloqueia text/html, image/svg+xml e afins de entrarem no metadado do GCS (anti-XSS).
  @IsIn(ALLOWED_UPLOAD_CONTENT_TYPES) contentType!: string
}
