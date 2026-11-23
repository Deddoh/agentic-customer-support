import { IsEnum, IsString, IsUUID, MaxLength } from 'class-validator';

export enum RemediableFaultType {
  FAILED_WITHDRAWAL_REFUND = 'FAILED_WITHDRAWAL_REFUND',
  MISSETTLED_BET_PAYOUT = 'MISSETTLED_BET_PAYOUT',
}

export class AutoRemediateDto {
  @IsUUID('4', { message: 'userId must be a valid UUID.' })
  userId: string;

  @IsString()
  @MaxLength(64)
  referenceId: string;

  @IsEnum(RemediableFaultType, {
    message:
      'faultType must be FAILED_WITHDRAWAL_REFUND or MISSETTLED_BET_PAYOUT.',
  })
  faultType: RemediableFaultType;
}
