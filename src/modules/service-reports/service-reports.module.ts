import { Module, forwardRef } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { WorkOrdersModule } from '../work-orders/work-orders.module';
import { ServiceReportsController } from './service-reports.controller';
import { ServiceReportsService } from './service-reports.service';

@Module({
  imports: [forwardRef(() => BookingsModule), forwardRef(() => WorkOrdersModule)],
  controllers: [ServiceReportsController],
  providers: [ServiceReportsService],
  exports: [ServiceReportsService],
})
export class ServiceReportsModule {}
