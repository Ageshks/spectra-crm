import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { WorkOrderPriority, WorkOrderStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateWorkOrderDto {
  @IsString()
  bookingId!: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const normalized = value.toUpperCase();
    return normalized === 'MEDIUM' ? WorkOrderPriority.NORMAL : normalized;
  })
  @IsIn(Object.values(WorkOrderPriority))
  priority?: WorkOrderPriority;

  @IsOptional()
  @Transform(({ value, obj }) => value ?? obj.preferredDate)
  @IsDateString({}, { message: 'scheduledDate must be an ISO date' })
  scheduledDate?: string;

  @IsOptional()
  @IsDateString()
  preferredDate?: string;

  @IsOptional()
  @Transform(({ value, obj }) => value ?? obj.preferredTime)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledStartTime must be HH:mm' })
  scheduledStartTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  preferredTime?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledEndTime must be HH:mm' })
  scheduledEndTime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  serviceNotes?: string;

  @IsOptional()
  @Transform(({ value, obj }) => value ?? obj.assignedManagerId)
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsString()
  assignedManagerId?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  employeeIds?: string[];
}

export class UpdateScheduleDto {
  @IsDateString({}, { message: 'scheduledDate must be an ISO date' })
  scheduledDate!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledStartTime must be HH:mm' })
  scheduledStartTime!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'scheduledEndTime must be HH:mm' })
  scheduledEndTime!: string;
}

export class UpdateWorkOrderStatusDto {
  @IsIn(Object.values(WorkOrderStatus))
  status!: WorkOrderStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SetManagerDto {
  @IsString()
  managerId!: string;
}

export class UpdatePriorityDto {
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const normalized = value.toUpperCase();
    return normalized === 'MEDIUM' ? WorkOrderPriority.NORMAL : normalized;
  })
  @IsIn(Object.values(WorkOrderPriority))
  priority!: WorkOrderPriority;
}

export class ListWorkOrdersDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(WorkOrderStatus))
  status?: WorkOrderStatus;

  @IsOptional()
  @IsIn(Object.values(WorkOrderPriority))
  priority?: WorkOrderPriority;

  @IsOptional()
  customerId?: string;

  @IsOptional()
  managerId?: string;

  @IsOptional()
  employeeId?: string;

  @IsOptional()
  @IsDateString()
  scheduledFrom?: string;

  @IsOptional()
  @IsDateString()
  scheduledTo?: string;

  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  mine?: boolean;
}
