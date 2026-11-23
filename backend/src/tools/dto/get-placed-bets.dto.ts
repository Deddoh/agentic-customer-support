import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class GetPlacedBetsDto {
  @IsUUID('4', { message: 'userId must be a valid UUID.' })
  userId: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  betId?: string;
}
