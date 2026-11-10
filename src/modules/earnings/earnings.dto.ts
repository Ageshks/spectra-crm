import { IsOptional, IsString, Matches, IsUUID } from 'class-validator';

export class EarningsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/)
  month?: string;

  @IsOptional()
  @IsUUID('4')
  employeeId?: string;
}
