import { Module } from '@nestjs/common';
import { UploadsModule } from '../../common/uploads/uploads.module';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [AttendanceModule, UploadsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
