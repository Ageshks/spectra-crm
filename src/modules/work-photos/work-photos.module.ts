import { Module } from '@nestjs/common';
import { WorkPhotosController } from './work-photos.controller';
import { WorkPhotosService } from './work-photos.service';

@Module({
  controllers: [WorkPhotosController],
  providers: [WorkPhotosService],
  exports: [WorkPhotosService],
})
export class WorkPhotosModule {}
