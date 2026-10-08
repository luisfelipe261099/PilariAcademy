import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Length, Max, Min } from 'class-validator'
import type { CouponType } from '@pilari/types'

export class CreateCouponDto {
  @IsString()
  @IsNotEmpty()
  @Length(2, 40)
  code!: string

  @IsIn(['percent', 'fixed'])
  type!: CouponType

  // Percentual (0–100) ou centavos. O @Max(100) evita desconto > 100% num cupom `percent`.
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  value!: number

  @IsOptional()
  @IsInt()
  @Min(1)
  maxUses?: number

  /** ISO (ex.: 2026-12-31T23:59:59Z). Sem isso o cupom nunca expira. */
  @IsOptional()
  @IsDateString()
  validUntil?: string
}

export class UpdateCouponDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  value?: number

  @IsOptional()
  @IsDateString()
  validUntil?: string
}
