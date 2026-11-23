import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { AlertSeverity, SecurityAlertType } from '@prisma/client';

export class SecurityAlertDto {
  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsEnum(SecurityAlertType)
  alertType: SecurityAlertType;

  @IsOptional()
  @IsEnum(AlertSeverity)
  severity?: AlertSeverity;

  @IsOptional()
  @IsBoolean()
  isSilentAdminAlert?: boolean;

  @IsString()
  @MaxLength(500)
  payloadSnippet: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  sourceIp?: string;
}
