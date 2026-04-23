import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PlayersModule } from './players/players.module';
import { TournamentsModule } from './tournaments/tournaments.module';
import { ClubsModule } from './clubs/clubs.module';
import { AdminModule } from './admin/admin.module';
import { RatingModule } from './rating/rating.module';

@Module({
  imports: [
    RatingModule.forRootDefault(),
    AuthModule,
    PlayersModule,
    TournamentsModule,
    ClubsModule,
    AdminModule,
  ],
})
export class AppModule {}
