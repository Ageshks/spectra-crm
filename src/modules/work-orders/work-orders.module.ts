import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { WorkOrdersController } from './work-orders.controller';
import { WorkOrdersService } from './work-orders.service';
import { WorkOrderStatusService } from './work-order-status.service';

@Module({
  imports: [BookingsModule],
  controllers: [WorkOrdersController],
  providers: [WorkOrdersService, WorkOrderStatusService],
  exports: [WorkOrdersService, WorkOrderStatusService],
})
export class WorkOrdersModule {}
