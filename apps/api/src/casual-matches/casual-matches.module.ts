import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CasualMatchesController } from './casual-matches.controller';
import { CasualMatchesService } from './casual-matches.service';

@Module({
  imports: [AuthModule],
  controllers: [CasualMatchesController],
  providers: [CasualMatchesService],
  exports: [CasualMatchesService],
})
export class CasualMatchesModule {}
