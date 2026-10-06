import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
} from 'class-validator';
import { AttendanceStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CheckInDto {
  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;
}

export class CheckOutDto extends CheckInDto {}

export class ListAttendanceDto extends PaginationDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsString()
  managerId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsIn(Object.values(AttendanceStatus))
  status?: AttendanceStatus;
}
