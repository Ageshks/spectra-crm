import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { AuthModule } from '../auth/auth.module';
import { ServiceLocationsController } from './service-locations.controller';

@Module({
  imports: [AuthModule],
  controllers: [CustomersController, ServiceLocationsController],
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}
