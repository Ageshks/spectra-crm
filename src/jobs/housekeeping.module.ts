import { Module } from '@nestjs/common';
import { ExportsModule } from '../modules/exports/exports.module';
import { HousekeepingService } from './housekeeping.service';

@Module({
  imports: [ExportsModule],
  providers: [HousekeepingService],
  exports: [HousekeepingService],
})
export class HousekeepingModule {}
