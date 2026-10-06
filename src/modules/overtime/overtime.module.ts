import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { OvertimeController } from './overtime.controller';
import { OvertimeService } from './overtime.service';

@Module({
  imports: [AttendanceModule],
  controllers: [OvertimeController],
  providers: [OvertimeService],
  exports: [OvertimeService],
})
export class OvertimeModule {}
