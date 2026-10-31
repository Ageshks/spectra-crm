import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { ServiceLocationsController } from './service-locations.controller';

@Module({
  controllers: [CustomersController, ServiceLocationsController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
