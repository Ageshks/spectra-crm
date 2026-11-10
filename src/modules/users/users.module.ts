import { Module } from '@nestjs/common';
import { UploadsModule } from '../../common/uploads/uploads.module';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  imports: [UploadsModule],
  exports: [UsersService],
})
export class UsersModule {}
