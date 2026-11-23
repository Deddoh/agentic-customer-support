import { Module } from '@nestjs/common';
import { InputSecurityPipe } from '../common/pipes/input-security.pipe';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  controllers: [ToolsController],
  providers: [ToolsService, InputSecurityPipe],
  exports: [ToolsService],
})
export class ToolsModule {}
