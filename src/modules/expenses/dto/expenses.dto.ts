import { ExpenseStatus } from '@prisma/client';
import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateExpenseDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(99999999.99)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  category!: string;

  @IsDateString()
  expenseDate!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  receiptUrl?: string;
}

export class ExpenseDecisionDto {
  @IsIn([ExpenseStatus.APPROVED, ExpenseStatus.REJECTED] as ExpenseStatus[])
  decision!: ExpenseStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListExpensesDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(ExpenseStatus))
  status?: ExpenseStatus;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
