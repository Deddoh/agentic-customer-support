import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { EscalationPriority, EscalationReason } from '@prisma/client';

export class EscalateDto {
  @IsUUID('4', { message: 'userId must be a valid UUID.' })
  userId: string;

  @IsEnum(EscalationReason)
  reason: EscalationReason;

  @IsEnum(EscalationPriority)
  priority: EscalationPriority;

  @IsString()
  @MinLength(10)
  @MaxLength(1500)
  summary: string;

  @IsOptional()
  @IsObject()
  diagnosticContext?: Record<string, unknown>;
}
