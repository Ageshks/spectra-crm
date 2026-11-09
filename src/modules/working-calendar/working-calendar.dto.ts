import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class WorkingCalendarExceptionDto {
  @IsDateString()
  date!: string;

  @IsIn(['HOLIDAY', 'WORKING_DAY', 'EVENT'])
  type!: 'HOLIDAY' | 'WORKING_DAY' | 'EVENT';

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SaveWorkingCalendarDto {
  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  /** ISO weekday values: Monday = 1, Sunday = 7. */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(7, { each: true })
  workingWeekdays!: number[];

  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => WorkingCalendarExceptionDto)
  exceptions!: WorkingCalendarExceptionDto[];
}
