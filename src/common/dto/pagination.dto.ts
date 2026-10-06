import { Type } from 'class-transformer';
import { IsInt, IsIn, IsOptional, IsString, Max, Min } from 'class-validator';
import { PAGINATION_DEFAULT_LIMIT, PAGINATION_DEFAULT_PAGE, PAGINATION_MAX_LIMIT } from '../constants';

export class PaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = PAGINATION_DEFAULT_PAGE;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINATION_MAX_LIMIT)
  limit: number = PAGINATION_DEFAULT_LIMIT;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';

  @IsOptional()
  @IsString()
  search?: string;
}
