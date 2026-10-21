import { IsIn, IsInt, IsObject, IsOptional, IsString, Max, Min } from 'class-validator';
import { ExportFormat } from '@prisma/client';
import { EXPORT_MAX_ROWS, EXPORT_TYPES } from '../../../common/constants';

export class CreateExportDto {
  @IsIn(Object.values(EXPORT_TYPES))
  type!: string;

  @IsOptional()
  @IsIn(Object.values(ExportFormat))
  format?: ExportFormat;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(EXPORT_MAX_ROWS)
  rowLimit?: number;

  @IsOptional()
  @IsString()
  fileName?: string;
}

import { PaginationDto } from '../../../common/dto/pagination.dto';

export class ListExportsDto extends PaginationDto {
  @IsOptional()
  status?: string;

  @IsOptional()
  type?: string;
}