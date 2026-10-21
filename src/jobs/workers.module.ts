import { Module } from '@nestjs/common';
import { ExportsModule } from '../modules/exports/exports.module';
import { WorkersService } from './workers.service';

@Module({
  imports: [ExportsModule],
  providers: [WorkersService],
  exports: [WorkersService],
})
export class WorkersModule {}
