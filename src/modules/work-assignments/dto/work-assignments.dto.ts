import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { WorkAssignmentStatus, WorkTransferStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/utils/transformers';

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  workOrderId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID(undefined, { each: true })
  employeeIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  estimatedServiceAmount?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  travelDistanceKm?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000)
  travelAllowanceRate?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(99999999.99)
  estimatedOtherExpenses?: number;
}

export class AssignmentActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ListAssignmentsDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(WorkAssignmentStatus))
  status?: WorkAssignmentStatus;

  @IsOptional()
  @IsString()
  workOrderId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  mine?: boolean;
}

export class CreateTransferDto {
  @IsUUID()
  @IsString()
  @IsNotEmpty()
  workOrderId!: string;

  @IsUUID()
  @IsString()
  @IsNotEmpty()
  toEmployeeId!: string;

  @IsString()
  @MinLength(5, { message: 'reason must be at least 5 characters' })
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ManagerReassignDto {
  @IsUUID()
  workOrderId!: string;

  @IsUUID()
  fromEmployeeId!: string;

  @IsUUID()
  toEmployeeId!: string;

  @IsString()
  @MinLength(5, { message: 'reason must be at least 5 characters' })
  @MaxLength(1000)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class TransferDecisionDto {
  @IsIn(['APPROVED', 'REJECTED'] as WorkTransferStatus[])
  decision!: WorkTransferStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListTransfersDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(WorkTransferStatus))
  status?: WorkTransferStatus;

  @IsOptional()
  workOrderId?: string;
}
