import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  AlertSeverity,
  BetSettlementStatus,
  EscalationQueue,
  EscalationReason,
  EscalationStatus,
  SecurityAlertType,
  WithdrawalStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  AutoRemediateDto,
  RemediableFaultType,
} from './dto/auto-remediate.dto';
import { CheckWithdrawalDto } from './dto/check-withdrawal.dto';
import { EscalateDto } from './dto/escalate.dto';
import { GetPlacedBetsDto } from './dto/get-placed-bets.dto';
import { LookupAccountDto } from './dto/lookup-account.dto';
import { SecurityAlertDto } from './dto/security-alert.dto';

const HOLDING_MESSAGE =
  'Your account is undergoing a routine security verification. Automated payouts and self-service remediations are temporarily paused while our compliance team completes this check.';

@Injectable()
export class ToolsService {
  private readonly maxAutoRemediateAmount: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {
    this.maxAutoRemediateAmount = Number(
      this.configService.get<string>('MAX_AUTO_REMEDIATE_AMOUNT') ?? '10000',
    );
  }

  async lookupCustomerAccount(dto: LookupAccountDto) {
    const user = await this.prisma.user.findFirst({
      where: {
        email: { equals: dto.email, mode: 'insensitive' },
        phone: dto.phone,
      },
    });

    if (!user) {
      return {
        found: false,
        message:
          'No account matched that email and phone number combination. Please double-check your details.',
      };
    }

    // Inspect recent customer journey logs for fraud/arb/multi-account anomalies
    const anomalousLogs = await this.prisma.customerJourneyLog.findMany({
      where: {
        userId: user.id,
        OR: [{ isAnomaly: true }, { riskScore: { gte: 75 } }],
      },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });

    const isFraudFlagged =
      user.accountStatus === AccountStatus.LOCKED_FRAUD_REVIEW ||
      anomalousLogs.length > 0;

    if (isFraudFlagged) {
      if (user.accountStatus !== AccountStatus.LOCKED_FRAUD_REVIEW) {
        await this.prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: { accountStatus: AccountStatus.LOCKED_FRAUD_REVIEW },
          });

          await tx.securityAlert.create({
            data: {
              userId: user.id,
              alertType: SecurityAlertType.FRAUD_ANOMALY,
              severity: AlertSeverity.CRITICAL,
              isSilentAdminAlert: true,
              payloadSnippet: `Silent fraud lock triggered during lookup. Anomalous events: ${anomalousLogs.length}`,
            },
          });

          await tx.auditLog.create({
            data: {
              userId: user.id,
              actor: 'NESTJS_RISK_ENGINE',
              action: 'FRAUD_LOCK_APPLIED',
              referenceId: user.id,
              details: {
                anomalousEventIds: anomalousLogs.map((l) => l.id),
                maxRiskScore: Math.max(
                  ...anomalousLogs.map((l) => l.riskScore),
                  0,
                ),
              },
            },
          });
        });
      }

      return {
        found: true,
        userId: user.id,
        fullName: user.fullName,
        accountStatus: AccountStatus.LOCKED_FRAUD_REVIEW,
        fraudLocked: true,
        holdingMessage: HOLDING_MESSAGE,
      };
    }

    return {
      found: true,
      userId: user.id,
      fullName: user.fullName,
      email: user.email,
      phone: user.phone,
      kycTier: user.kycTier,
      accountStatus: user.accountStatus,
      walletBalance: Number(user.walletBalance),
      currency: user.currency,
      fraudLocked: false,
    };
  }

  async getPlacedBets(dto: GetPlacedBetsDto) {
    const user = await this.requireActiveUserOrHolding(dto.userId);
    if ('fraudLocked' in user) {
      return user;
    }

    const bets = await this.prisma.bet.findMany({
      where: {
        userId: dto.userId,
        ...(dto.betId
          ? {
              OR: [{ id: dto.betId }, { betSlipCode: dto.betId }],
            }
          : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: 10,
    });

    return {
      userId: dto.userId,
      count: bets.length,
      bets: bets.map((bet) => ({
        id: bet.id,
        betSlipCode: bet.betSlipCode,
        matchName: bet.matchName,
        market: bet.market,
        selection: bet.selection,
        odds: Number(bet.odds),
        stake: Number(bet.stake),
        potentialPayout: Number(bet.potentialPayout),
        officialMatchResult: bet.officialMatchResult,
        settlementStatus: bet.settlementStatus,
        payoutCredited: bet.payoutCredited,
        remediationEligible:
          bet.settlementStatus === BetSettlementStatus.MISSETTLED &&
          !bet.payoutCredited,
        placedAt: bet.placedAt,
        settledAt: bet.settledAt,
      })),
    };
  }

  async checkWithdrawalStatus(dto: CheckWithdrawalDto) {
    const user = await this.requireActiveUserOrHolding(dto.userId);
    if ('fraudLocked' in user) {
      return user;
    }

    const withdrawals = await this.prisma.withdrawal.findMany({
      where: {
        userId: dto.userId,
        ...(dto.transactionId
          ? {
              OR: [
                { id: dto.transactionId },
                { transactionRef: dto.transactionId },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return {
      userId: dto.userId,
      count: withdrawals.length,
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        transactionRef: w.transactionRef,
        amount: Number(w.amount),
        channel: w.channel,
        destination: w.destination,
        status: w.status,
        gatewayCode: w.gatewayCode,
        failureReason: w.failureReason,
        autoRefunded: w.autoRefunded,
        remediationEligible:
          w.status === WithdrawalStatus.FAILED_NEEDS_REFUND && !w.autoRefunded,
        createdAt: w.createdAt,
      })),
    };
  }

  async autoRemediateVerifiedFault(dto: AutoRemediateDto) {
    const userCheck = await this.requireActiveUserOrHolding(dto.userId);
    if ('fraudLocked' in userCheck) {
      return {
        resolved: false,
        fraudLocked: true,
        message: HOLDING_MESSAGE,
      };
    }

    if (dto.faultType === RemediableFaultType.FAILED_WITHDRAWAL_REFUND) {
      return this.remediateFailedWithdrawal(dto.userId, dto.referenceId);
    }

    if (dto.faultType === RemediableFaultType.MISSETTLED_BET_PAYOUT) {
      return this.remediateMissettledBet(dto.userId, dto.referenceId);
    }

    throw new BadRequestException('Unsupported faultType.');
  }

  private async remediateFailedWithdrawal(userId: string, referenceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const withdrawal = await tx.withdrawal.findFirst({
        where: {
          userId,
          OR: [{ id: referenceId }, { transactionRef: referenceId }],
        },
      });

      if (!withdrawal) {
        throw new NotFoundException(
          `Withdrawal ${referenceId} not found for this user.`,
        );
      }

      if (
        withdrawal.status !== WithdrawalStatus.FAILED_NEEDS_REFUND ||
        withdrawal.autoRefunded
      ) {
        return {
          resolved: false,
          requiresHitl: false,
          reason: 'NOT_ELIGIBLE',
          message: `Withdrawal ${withdrawal.transactionRef} is in status ${withdrawal.status} (autoRefunded=${withdrawal.autoRefunded}) and does not qualify for automated refund.`,
        };
      }

      const amount = Number(withdrawal.amount);
      if (amount > this.maxAutoRemediateAmount) {
        return {
          resolved: false,
          requiresHitl: true,
          reason: 'EXCEEDS_AUTO_REMEDIATE_THRESHOLD',
          amount,
          threshold: this.maxAutoRemediateAmount,
          referenceId: withdrawal.transactionRef,
          message: `Verified failed withdrawal ${withdrawal.transactionRef} (${amount} KES) exceeds the autonomous remediation limit (${this.maxAutoRemediateAmount} KES). Escalate to HITL approval.`,
        };
      }

      const updatedWithdrawal = await tx.withdrawal.update({
        where: { id: withdrawal.id },
        data: {
          status: WithdrawalStatus.REFUNDED,
          autoRefunded: true,
        },
      });

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          walletBalance: { increment: withdrawal.amount },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          actor: 'NESTJS_AUTO_REMEDIATION',
          action: 'AUTO_REFUND_FAILED_WITHDRAWAL',
          referenceId: withdrawal.transactionRef,
          amountAffected: withdrawal.amount,
          details: {
            withdrawalId: withdrawal.id,
            gatewayCode: withdrawal.gatewayCode,
            newWalletBalance: Number(updatedUser.walletBalance),
          },
        },
      });

      return {
        resolved: true,
        action: 'AUTO_REFUND_FAILED_WITHDRAWAL',
        referenceId: updatedWithdrawal.transactionRef,
        amountCredited: amount,
        currency: updatedUser.currency,
        newWalletBalance: Number(updatedUser.walletBalance),
        message: `Auto-resolved: ${amount} ${updatedUser.currency} from failed withdrawal ${updatedWithdrawal.transactionRef} has been refunded to your wallet.`,
      };
    });
  }

  private async remediateMissettledBet(userId: string, referenceId: string) {
    return this.prisma.$transaction(async (tx) => {
      const bet = await tx.bet.findFirst({
        where: {
          userId,
          OR: [{ id: referenceId }, { betSlipCode: referenceId }],
        },
      });

      if (!bet) {
        throw new NotFoundException(
          `Bet ${referenceId} not found for this user.`,
        );
      }

      const feedConfirmsWin =
        bet.officialMatchResult !== null &&
        bet.officialMatchResult.includes(bet.selection);

      if (
        bet.settlementStatus !== BetSettlementStatus.MISSETTLED ||
        bet.payoutCredited ||
        !feedConfirmsWin
      ) {
        return {
          resolved: false,
          requiresHitl: false,
          reason: 'NOT_ELIGIBLE',
          message: `Bet ${bet.betSlipCode} cannot be auto-resettled (status=${bet.settlementStatus}, payoutCredited=${bet.payoutCredited}, feedConfirmsWin=${feedConfirmsWin}).`,
        };
      }

      const payout = Number(bet.potentialPayout);
      if (payout > this.maxAutoRemediateAmount) {
        return {
          resolved: false,
          requiresHitl: true,
          reason: 'EXCEEDS_AUTO_REMEDIATE_THRESHOLD',
          amount: payout,
          threshold: this.maxAutoRemediateAmount,
          referenceId: bet.betSlipCode,
          message: `Verified mis-settled bet ${bet.betSlipCode} payout (${payout} KES) exceeds the autonomous remediation limit (${this.maxAutoRemediateAmount} KES). Escalate to HITL approval.`,
        };
      }

      const updatedBet = await tx.bet.update({
        where: { id: bet.id },
        data: {
          settlementStatus: BetSettlementStatus.WON,
          payoutCredited: true,
          settledAt: new Date(),
        },
      });

      const updatedUser = await tx.user.update({
        where: { id: userId },
        data: {
          walletBalance: { increment: bet.potentialPayout },
        },
      });

      await tx.auditLog.create({
        data: {
          userId,
          actor: 'NESTJS_AUTO_REMEDIATION',
          action: 'AUTO_RESETTLE_MISSETTLED_BET',
          referenceId: bet.betSlipCode,
          amountAffected: bet.potentialPayout,
          details: {
            betId: bet.id,
            matchName: bet.matchName,
            officialMatchResult: bet.officialMatchResult,
            newWalletBalance: Number(updatedUser.walletBalance),
          },
        },
      });

      return {
        resolved: true,
        action: 'AUTO_RESETTLE_MISSETTLED_BET',
        referenceId: updatedBet.betSlipCode,
        amountCredited: payout,
        currency: updatedUser.currency,
        newWalletBalance: Number(updatedUser.walletBalance),
        message: `Auto-resolved: Bet ${updatedBet.betSlipCode} (${updatedBet.matchName}) was verified against official result (${updatedBet.officialMatchResult}) and ${payout} ${updatedUser.currency} has been credited to your wallet.`,
      };
    });
  }

  async escalateToHitlOrLiveAgent(dto: EscalateDto) {
    const user = await this.prisma.user.findUnique({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`User ${dto.userId} not found.`);
    }

    const isHitl = dto.reason === EscalationReason.HIGH_VALUE_DISPUTE;
    const assignedQueue = isHitl
      ? EscalationQueue.HITL_APPROVAL
      : EscalationQueue.LIVE_SUPPORT;
    const status = isHitl
      ? EscalationStatus.OPEN_HITL
      : EscalationStatus.ASSIGNED_LIVE_AGENT;

    const ticketCode = `TKT-${Date.now().toString().slice(-6)}`;

    const ticket = await this.prisma.$transaction(async (tx) => {
      const created = await tx.escalationTicket.create({
        data: {
          ticketCode,
          userId: dto.userId,
          reason: dto.reason,
          priority: dto.priority,
          status,
          assignedQueue,
          summary: dto.summary,
          diagnosticContext: (dto.diagnosticContext ?? {}) as any,
        },
      });

      await tx.auditLog.create({
        data: {
          userId: dto.userId,
          actor: 'ADK_AGENT',
          action: 'ESCALATION_TICKET_CREATED',
          referenceId: ticketCode,
          details: {
            reason: dto.reason,
            priority: dto.priority,
            assignedQueue,
          },
        },
      });

      return created;
    });

    return {
      escalated: true,
      ticketCode: ticket.ticketCode,
      assignedQueue: ticket.assignedQueue,
      status: ticket.status,
      priority: ticket.priority,
      message: `Ticket ${ticket.ticketCode} created and routed to ${ticket.assignedQueue}.`,
    };
  }

  async createSecurityAlert(dto: SecurityAlertDto) {
    const alert = await this.prisma.securityAlert.create({
      data: {
        userId: dto.userId ?? null,
        alertType: dto.alertType,
        severity: dto.severity ?? AlertSeverity.CRITICAL,
        isSilentAdminAlert: dto.isSilentAdminAlert ?? false,
        payloadSnippet: dto.payloadSnippet,
        sourceIp: dto.sourceIp ?? null,
      },
    });

    return {
      logged: true,
      alertId: alert.id,
      alertType: alert.alertType,
    };
  }

  private async requireActiveUserOrHolding(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(`User ${userId} not found.`);
    }

    if (user.accountStatus === AccountStatus.LOCKED_FRAUD_REVIEW) {
      return {
        userId: user.id,
        accountStatus: user.accountStatus,
        fraudLocked: true,
        holdingMessage: HOLDING_MESSAGE,
      };
    }

    return user;
  }
}
