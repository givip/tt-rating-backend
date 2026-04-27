import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [AuthModule],
  providers: [InvitesService],
  controllers: [InvitesController],
})
export class InvitesModule {}
