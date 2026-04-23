import { Module } from '@nestjs/common';
import { TournamentsController } from './tournaments.controller';
import { TournamentsService } from './tournaments.service';
import { AuthModule } from '../auth/auth.module';
import { RatingModule } from '../rating/rating.module';

@Module({
  imports: [AuthModule, RatingModule],
  controllers: [TournamentsController],
  providers: [TournamentsService],
  exports: [TournamentsService],
})
export class TournamentsModule {}
