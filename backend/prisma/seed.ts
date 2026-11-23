import {
  PrismaClient,
  KycTier,
  AccountStatus,
  BetSettlementStatus,
  WithdrawalChannel,
  WithdrawalStatus,
  JourneyEventType,
} from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding SportPesa-style Agentic CX database...');

  // Clean existing records in dependency order for idempotent re-seeding
  await prisma.auditLog.deleteMany();
  await prisma.securityAlert.deleteMany();
  await prisma.escalationTicket.deleteMany();
  await prisma.customerJourneyLog.deleteMany();
  await prisma.withdrawal.deleteMany();
  await prisma.bet.deleteMany();
  await prisma.user.deleteMany();

  // =========================================================================
  // SCENARIO 1: Customer with a Winning Bet + a Mis-settled Bet (Auto-Fixable)
  // =========================================================================
  const amara = await prisma.user.create({
    data: {
      email: 'amara.wanjiku@example.com',
      phone: '+254712345001',
      fullName: 'Amara Wanjiku',
      kycTier: KycTier.TIER_2,
      accountStatus: AccountStatus.ACTIVE,
      walletBalance: 3200.0,
      currency: 'KES',
    },
  });

  await prisma.bet.createMany({
    data: [
      {
        betSlipCode: 'SP-BET-1001',
        userId: amara.id,
        matchName: 'Manchester City vs Liverpool',
        market: '1X2',
        selection: 'HOME_WIN',
        odds: 2.15,
        stake: 1000.0,
        potentialPayout: 2150.0,
        officialMatchResult: '3-1 (HOME_WIN)',
        settlementStatus: BetSettlementStatus.WON,
        payoutCredited: true,
        settledAt: new Date(Date.now() - 1000 * 60 * 60 * 5),
      },
      {
        betSlipCode: 'SP-BET-1002',
        userId: amara.id,
        matchName: 'Arsenal vs Chelsea',
        market: '1X2',
        selection: 'HOME_WIN',
        odds: 2.3,
        stake: 500.0,
        potentialPayout: 1150.0,
        officialMatchResult: '2-1 (HOME_WIN)',
        settlementStatus: BetSettlementStatus.MISSETTLED,
        payoutCredited: false,
        settledAt: new Date(Date.now() - 1000 * 60 * 45),
      },
    ],
  });

  await prisma.customerJourneyLog.create({
    data: {
      userId: amara.id,
      eventType: JourneyEventType.BET_PLACED,
      ipAddress: '197.232.45.10',
      deviceFingerprint: 'dev-amara-android-01',
      amount: 500.0,
      riskScore: 5,
      isAnomaly: false,
      metadata: { betSlipCode: 'SP-BET-1002' },
    },
  });

  // =========================================================================
  // SCENARIO 2: Customer with a Stuck/Failed M-Pesa Withdrawal
  // =========================================================================
  const brian = await prisma.user.create({
    data: {
      email: 'brian.kiprop@example.com',
      phone: '+254722345002',
      fullName: 'Brian Kiprop',
      kycTier: KycTier.TIER_2,
      accountStatus: AccountStatus.ACTIVE,
      walletBalance: 450.0,
      currency: 'KES',
    },
  });

  await prisma.withdrawal.createMany({
    data: [
      {
        transactionRef: 'MPESA-WD-9001',
        userId: brian.id,
        amount: 2500.0,
        channel: WithdrawalChannel.MPESA,
        destination: '+254722345002',
        status: WithdrawalStatus.FAILED_NEEDS_REFUND,
        gatewayCode: 'MPESA_GW_TIMEOUT_504',
        failureReason:
          'Safaricom Daraja B2C callback timeout; wallet debited but auto-refund job missed.',
        autoRefunded: false,
      },
      {
        transactionRef: 'MPESA-WD-9002',
        userId: brian.id,
        amount: 25000.0,
        channel: WithdrawalChannel.MPESA,
        destination: '+254722345002',
        status: WithdrawalStatus.FAILED_NEEDS_REFUND,
        gatewayCode: 'MPESA_B2C_LIMIT_422',
        failureReason:
          'Payout exceeds single M-Pesa B2C gateway limit; requires manual HITL split/refund.',
        autoRefunded: false,
      },
      {
        transactionRef: 'MPESA-WD-8990',
        userId: brian.id,
        amount: 1200.0,
        channel: WithdrawalChannel.MPESA,
        destination: '+254722345002',
        status: WithdrawalStatus.COMPLETED,
        gatewayCode: 'MPESA_OK_0',
        failureReason: null,
        autoRefunded: false,
      },
    ],
  });

  await prisma.customerJourneyLog.create({
    data: {
      userId: brian.id,
      eventType: JourneyEventType.WITHDRAWAL_ATTEMPT,
      ipAddress: '105.163.12.88',
      deviceFingerprint: 'dev-brian-ios-02',
      amount: 2500.0,
      riskScore: 10,
      isAnomaly: false,
      metadata: { transactionRef: 'MPESA-WD-9001' },
    },
  });

  // =========================================================================
  // SCENARIO 3: Fraud-Flagged Customer (Silent Admin Alert + Account Lock)
  // =========================================================================
  const carlos = await prisma.user.create({
    data: {
      email: 'carlos.otieno@example.com',
      phone: '+254733345003',
      fullName: 'Carlos Otieno',
      kycTier: KycTier.TIER_1,
      accountStatus: AccountStatus.ACTIVE, // Will be locked silently on lookup
      walletBalance: 18500.0,
      currency: 'KES',
    },
  });

  await prisma.customerJourneyLog.createMany({
    data: [
      {
        userId: carlos.id,
        eventType: JourneyEventType.BONUS_CLAIM,
        ipAddress: '41.89.200.14',
        deviceFingerprint: 'dev-shared-emulator-99',
        amount: 5000.0,
        riskScore: 85,
        isAnomaly: true,
        metadata: {
          flag: 'MULTI_ACCOUNT_BONUS_ABUSE',
          linkedAccountsDetected: 4,
        },
      },
      {
        userId: carlos.id,
        eventType: JourneyEventType.DEPOSIT,
        ipAddress: '185.220.101.4',
        deviceFingerprint: 'dev-tor-exit-07',
        amount: 13500.0,
        riskScore: 92,
        isAnomaly: true,
        metadata: {
          flag: 'RAPID_DEPOSIT_WITHDRAWAL_CYCLE',
          arbitragePattern: true,
        },
      },
      {
        userId: carlos.id,
        eventType: JourneyEventType.WITHDRAWAL_ATTEMPT,
        ipAddress: '185.220.101.4',
        deviceFingerprint: 'dev-tor-exit-07',
        amount: 18500.0,
        riskScore: 95,
        isAnomaly: true,
        metadata: {
          flag: 'NO_TURNOVER_IMMEDIATE_CASHOUT',
        },
      },
    ],
  });

  await prisma.withdrawal.create({
    data: {
      transactionRef: 'MPESA-WD-7777',
      userId: carlos.id,
      amount: 18500.0,
      channel: WithdrawalChannel.MPESA,
      destination: '+254733345003',
      status: WithdrawalStatus.LOCKED,
      gatewayCode: 'RISK_HOLD_AML',
      failureReason: 'Pending internal compliance review.',
      autoRefunded: false,
    },
  });

  console.log('Seed completed successfully:');
  console.log(`- Amara (Winning + Mis-settled bet): ${amara.email} / ${amara.phone}`);
  console.log(`- Brian (Stuck M-Pesa withdrawal):   ${brian.email} / ${brian.phone}`);
  console.log(`- Carlos (Fraud-flagged account):    ${carlos.email} / ${carlos.phone}`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
