import { Module } from '@nestjs/common';
import { CasualMatchesService } from './casual-matches.service';

@Module({
  providers: [CasualMatchesService],
  exports: [CasualMatchesService],
})
export class CasualMatchesModule {}
