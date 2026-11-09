import { Module } from '@nestjs/common';
import { WorkingCalendarModule } from '../working-calendar/working-calendar.module';
import { AttendanceController } from './attendance.controller';
import { AttendanceService } from './attendance.service';

@Module({
  imports: [WorkingCalendarModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
