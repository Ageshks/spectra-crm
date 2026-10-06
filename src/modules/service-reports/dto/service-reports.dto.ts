import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ServiceReportStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateServiceReportDto {
  @IsString()
  @IsNotEmpty()
  workOrderId!: string;

  @IsString()
  @MaxLength(5000)
  workSummary!: string;

  @IsString()
  @MaxLength(10000)
  workPerformed!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  issuesFound?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  materialsUsed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  recommendations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  completionRemarks?: string;

  /** When true the report is submitted for review immediately. */
  @IsOptional()
  @IsBoolean()
  submit?: boolean;
}

export class UpdateServiceReportDto {
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  workSummary?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  workPerformed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  issuesFound?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  materialsUsed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  recommendations?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  completionRemarks?: string;
}

export class ReportDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListServiceReportsDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(ServiceReportStatus))
  status?: ServiceReportStatus;

  @IsOptional()
  @IsString()
  workOrderId?: string;

  @IsOptional()
  @IsString()
  employeeId?: string;
}
