import { Module } from '@nestjs/common';
import { UploadsModule } from '../../common/uploads/uploads.module';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';

@Module({ imports: [UploadsModule], controllers: [BillingController], providers: [BillingService], exports: [BillingService] })
export class BillingModule {}
