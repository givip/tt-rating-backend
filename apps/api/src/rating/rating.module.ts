import { Module } from '@nestjs/common';
import { CloudRunService } from './cloud-run.service';

@Module({
  providers: [CloudRunService],
  exports: [CloudRunService],
})
export class RatingModule {}
