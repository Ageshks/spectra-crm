import { Type } from 'class-transformer';
import { IsDateString, IsOptional } from 'class-validator';
import { PaginationDto } from './pagination.dto';

export class RangeQueryDto extends PaginationDto {
  @IsOptional()
  @IsDateString({}, { message: 'startDate must be an ISO date' })
  startDate?: string;

  @IsOptional()
  @IsDateString({}, { message: 'endDate must be an ISO date' })
  endDate?: string;
}
