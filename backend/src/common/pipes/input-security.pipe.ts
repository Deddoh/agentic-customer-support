import {
  ArgumentMetadata,
  ForbiddenException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';
import { AlertSeverity, SecurityAlertType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const SQLI_PATTERNS: RegExp[] = [
  /(\b(union|select|insert|update|delete|drop|alter|truncate|exec|execute)\b\s+.*\b(from|into|table|database|where|all)\b)/i,
  /(['";]\s*(or|and)\s+[\w'"]+\s*=\s*[\w'"]+)/i,
  /(--|\/\*|\*\/|;\s*drop\s+table|xp_cmdshell)/i,
];

const PROMPT_INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i,
  /reveal\s+(your\s+)?(system\s+prompt|hidden\s+instructions)/i,
  /\b(jailbreak|dan\s+mode|developer\s+mode)\b/i,
];

const HARASSMENT_PATTERNS: RegExp[] = [
  /\b(kill\s+you|bomb\s+your|shoot\s+you|die\s+scam)\b/i,
];

@Injectable()
export class InputSecurityPipe implements PipeTransform {
  constructor(private readonly prisma: PrismaService) {}

  async transform(value: unknown, _metadata: ArgumentMetadata) {
    if (value === null || value === undefined) {
      return value;
    }

    const stringsToInspect = this.extractStrings(value);

    for (const rawText of stringsToInspect) {
      const threat = this.detectThreat(rawText);
      if (threat) {
        await this.prisma.securityAlert.create({
          data: {
            alertType: threat.type,
            severity: AlertSeverity.CRITICAL,
            isSilentAdminAlert: false,
            payloadSnippet: rawText.slice(0, 300),
            userId: this.extractOptionalUserId(value),
          },
        });

        throw new ForbiddenException({
          blocked: true,
          escalateToLiveAgent: false,
          alertType: threat.type,
          message:
            'Security Policy Violation: Your input contains prohibited or malicious patterns and has been blocked. This session cannot proceed to support.',
        });
      }
    }

    return this.sanitizeValue(value);
  }

  private detectThreat(
    text: string,
  ): { type: SecurityAlertType } | null {
    if (SQLI_PATTERNS.some((rx) => rx.test(text))) {
      return { type: SecurityAlertType.SQL_INJECTION };
    }
    if (PROMPT_INJECTION_PATTERNS.some((rx) => rx.test(text))) {
      return { type: SecurityAlertType.PROMPT_INJECTION };
    }
    if (HARASSMENT_PATTERNS.some((rx) => rx.test(text))) {
      return { type: SecurityAlertType.HARASSMENT };
    }
    return null;
  }

  private extractStrings(value: unknown): string[] {
    if (typeof value === 'string') {
      return [value];
    }
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractStrings(item));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).flatMap((v) => this.extractStrings(v));
    }
    return [];
  }

  private sanitizeValue(value: unknown): unknown {
    if (typeof value === 'string') {
      // Strip null bytes and trim outer whitespace without mutating valid emails/phones
      return value.replace(/\0/g, '').trim();
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }
    if (typeof value === 'object' && value !== null) {
      const sanitized: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        sanitized[k] = this.sanitizeValue(v);
      }
      return sanitized;
    }
    return value;
  }

  private extractOptionalUserId(value: unknown): string | null {
    if (
      typeof value === 'object' &&
      value !== null &&
      'userId' in value &&
      typeof (value as Record<string, unknown>).userId === 'string'
    ) {
      return (value as Record<string, unknown>).userId as string;
    }
    return null;
  }
}
