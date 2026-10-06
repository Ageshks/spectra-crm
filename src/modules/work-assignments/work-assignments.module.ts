import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import {
  WorkAssignmentsController,
  WorkTransfersController,
} from './work-assignments.controller';
import { WorkAssignmentsService } from './work-assignments.service';
import { WorkTransfersService } from './work-transfers.service';

@Module({
  imports: [WorkOrdersModule, BookingsModule],
  controllers: [WorkAssignmentsController, WorkTransfersController],
  providers: [WorkAssignmentsService, WorkTransfersService],
  exports: [WorkAssignmentsService, WorkTransfersService],
})
export class WorkAssignmentsModule {}
