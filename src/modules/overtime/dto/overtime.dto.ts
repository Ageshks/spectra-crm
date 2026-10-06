import { IsDateString, IsIn, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { OvertimeStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateOvertimeDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsDateString()
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class OvertimeDecisionDto {
  @IsIn(Object.values([OvertimeStatus.APPROVED, OvertimeStatus.REJECTED]) as OvertimeStatus[])
  decision!: OvertimeStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class RecordOvertimePaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;
}

export class ListOvertimeDto extends PaginationDto {
  @IsOptional()
  @IsString()
  employeeId?: string;

  @IsOptional()
  @IsIn(Object.values(OvertimeStatus))
  status?: OvertimeStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
