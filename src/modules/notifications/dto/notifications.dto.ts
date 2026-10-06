import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { DevicePlatform, NotificationType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class RegisterDeviceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(512)
  token!: string;

  @IsIn(Object.values(DevicePlatform))
  platform!: DevicePlatform;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  deviceName?: string;
}

export class ListNotificationsDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(NotificationType))
  type?: NotificationType;

  @IsOptional()
  isRead?: boolean;
}
