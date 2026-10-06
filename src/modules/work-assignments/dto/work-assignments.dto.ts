import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { WorkAssignmentStatus, WorkTransferStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/utils/transformers';

export class CreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  workOrderId!: string;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  employeeIds!: string[];
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
  @IsString()
  @IsNotEmpty()
  workOrderId!: string;

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
