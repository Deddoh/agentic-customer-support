import { Body, Controller, Get, Post, UseGuards, UsePipes } from '@nestjs/common';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { InputSecurityPipe } from '../common/pipes/input-security.pipe';
import { AutoRemediateDto } from './dto/auto-remediate.dto';
import { CheckWithdrawalDto } from './dto/check-withdrawal.dto';
import { EscalateDto } from './dto/escalate.dto';
import { GetPlacedBetsDto } from './dto/get-placed-bets.dto';
import { LookupAccountDto } from './dto/lookup-account.dto';
import { SecurityAlertDto } from './dto/security-alert.dto';
import { ToolsService } from './tools.service';

@Controller('api/tools')
@UseGuards(InternalApiKeyGuard)
@UsePipes(InputSecurityPipe)
export class ToolsController {
  constructor(private readonly toolsService: ToolsService) {}

  @Get('health')
  health() {
    return { status: 'ok', service: 'betting-cx-nestjs-tools' };
  }

  @Post('lookup-account')
  lookupAccount(@Body() dto: LookupAccountDto) {
    return this.toolsService.lookupCustomerAccount(dto);
  }

  @Post('placed-bets')
  getPlacedBets(@Body() dto: GetPlacedBetsDto) {
    return this.toolsService.getPlacedBets(dto);
  }

  @Post('withdrawal-status')
  checkWithdrawalStatus(@Body() dto: CheckWithdrawalDto) {
    return this.toolsService.checkWithdrawalStatus(dto);
  }

  @Post('auto-remediate')
  autoRemediate(@Body() dto: AutoRemediateDto) {
    return this.toolsService.autoRemediateVerifiedFault(dto);
  }

  @Post('escalate')
  escalate(@Body() dto: EscalateDto) {
    return this.toolsService.escalateToHitlOrLiveAgent(dto);
  }

  @Post('security-alert')
  createSecurityAlert(@Body() dto: SecurityAlertDto) {
    return this.toolsService.createSecurityAlert(dto);
  }
}
