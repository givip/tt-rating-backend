import { Module } from '@nestjs/common';
import { PlayersController } from './players.controller';
import { PlayersService } from './players.service';
import { AuthModule } from '../auth/auth.module';
import { CasualMatchesModule } from '../casual-matches/casual-matches.module';

@Module({
  imports: [AuthModule, CasualMatchesModule],
  controllers: [PlayersController],
  providers: [PlayersService],
  exports: [PlayersService],
})
export class PlayersModule {}
