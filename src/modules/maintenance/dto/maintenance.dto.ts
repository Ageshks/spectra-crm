import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { MaintenanceFrequency, MaintenanceStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateMaintenanceDto {
  @IsUUID('4')
  customerId!: string;

  @IsUUID('4')
  serviceId!: string;

  @IsUUID('4')
  serviceLocationId!: string;

  @IsOptional()
  @IsDateString()
  lastServiceDate?: string;

  @IsDateString()
  nextServiceDate!: string;

  @IsIn(Object.values(MaintenanceFrequency))
  frequency!: MaintenanceFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  customIntervalDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;
}

export class UpdateMaintenanceDto {
  @IsOptional()
  @IsDateString()
  lastServiceDate?: string;

  @IsOptional()
  @IsDateString()
  nextServiceDate?: string;

  @IsOptional()
  @IsIn(Object.values(MaintenanceFrequency))
  frequency?: MaintenanceFrequency;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(3650)
  customIntervalDays?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(30)
  reminderDaysBefore?: number;

  @IsOptional()
  @IsIn(Object.values(MaintenanceStatus))
  status?: MaintenanceStatus;
}

export class ListMaintenanceDto extends PaginationDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsIn(Object.values(MaintenanceStatus))
  status?: MaintenanceStatus;

  @IsOptional()
  @IsDateString()
  dueFrom?: string;

  @IsOptional()
  @IsDateString()
  dueTo?: string;
}
