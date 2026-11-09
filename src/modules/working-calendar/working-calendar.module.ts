import { Module } from '@nestjs/common';
import { WorkingCalendarController } from './working-calendar.controller';
import { WorkingCalendarService } from './working-calendar.service';

@Module({
  controllers: [WorkingCalendarController],
  providers: [WorkingCalendarService],
  exports: [WorkingCalendarService],
})
export class WorkingCalendarModule {}
