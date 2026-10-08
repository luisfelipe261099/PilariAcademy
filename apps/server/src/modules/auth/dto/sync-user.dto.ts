import { IsOptional, IsString } from 'class-validator'

/** Corpo opcional do POST /auth/sync-user-data (o cliente pode mandar nome/foto). */
export class SyncUserDto {
  @IsOptional()
  @IsString()
  displayName?: string

  @IsOptional()
  @IsString()
  photoUrl?: string
}
