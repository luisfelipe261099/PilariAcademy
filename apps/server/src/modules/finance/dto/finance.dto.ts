import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator'

export class RegisterPayoutDto {
  @IsString() @IsNotEmpty() instructorId!: string
  @IsInt() @Min(1) amountInCents!: number
  @IsOptional() @IsString() note?: string
}

export class SetCommissionDto {
  @IsInt() @Min(0) @Max(100) commissionPercent!: number
}
