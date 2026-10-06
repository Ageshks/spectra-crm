import {
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { BookingStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty({ message: 'serviceId is required' })
  serviceId!: string;

  @IsString()
  @IsNotEmpty({ message: 'serviceLocationId is required' })
  serviceLocationId!: string;

  @IsDateString({}, { message: 'preferredDate must be an ISO date' })
  preferredDate!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'preferredTime must be HH:mm' })
  preferredTime!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;

  /** Required when an admin creates a booking on behalf of a customer. */
  @IsOptional()
  @IsString()
  customerId?: string;
}

export class UpdateBookingStatusDto {
  @IsIn([
    'CONFIRMED',
    'SCHEDULED',
    'CANCELLED',
  ] as BookingStatus[])
  status!: BookingStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancelReason?: string;
}

export class ListBookingsDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(BookingStatus))
  status?: BookingStatus;

  @IsOptional()
  serviceId?: string;

  @IsOptional()
  customerId?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
