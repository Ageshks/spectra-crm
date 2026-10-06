import { IsDateString, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { LeaveStatus, LeaveType } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateLeaveDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsIn(Object.values(LeaveType))
  leaveType!: LeaveType;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  @IsString()
  @MaxLength(1000)
  reason!: string;
}

export class LeaveDecisionDto {
  @IsIn([LeaveStatus.APPROVED, LeaveStatus.REJECTED] as LeaveStatus[])
  decision!: LeaveStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListLeaveDto extends PaginationDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsIn(Object.values(LeaveStatus))
  status?: LeaveStatus;

  @IsOptional()
  @IsIn(Object.values(LeaveType))
  leaveType?: LeaveType;
}
