import { Module } from '@nestjs/common';
import { AttendanceModule } from '../attendance/attendance.module';
import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';
import { ExportBuilderService } from './export-builder.service';
import { ExportStorageService } from './export-storage.service';

@Module({
  imports: [AttendanceModule],
  controllers: [ExportsController],
  providers: [ExportsService, ExportBuilderService, ExportStorageService],
  exports: [ExportsService, ExportBuilderService, ExportStorageService],
})
export class ExportsModule {}