import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { EnquiryStatus, WorkOrderPriority } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateEnquiryDto {
  @IsOptional()
  @IsString()
  companySlug?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  @Transform(({ value, obj }) => value ?? obj.contactName)
  name!: string;

  @Matches(/^\+?[0-9][0-9\s\-]{6,14}[0-9]$/, { message: 'phone must be a valid phone number' })
  phone!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be a valid email address' })
  email!: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  @Transform(({ value, obj }) => value ?? obj.company)
  companyName?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value, obj }) => value ?? obj.requestedService)
  serviceId?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value !== 'string') return value;
    const normalized = value.toUpperCase();
    if (normalized === 'MEDIUM') return WorkOrderPriority.NORMAL;
    return normalized;
  })
  @IsIn(Object.values(WorkOrderPriority))
  priority?: WorkOrderPriority;

  @IsOptional()
  @IsString()
  serviceLocationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  @Transform(({ value, obj }) => value ?? obj.customerMessage)
  message?: string;

  /** Explicit customer first name; falls back to the enquiry contact name. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  customerFirstName?: string;

  /** Explicit customer last name; falls back to the remaining contact-name parts. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value)
  customerLastName?: string;
}

export class AssignEnquiryDto {
  @IsString()
  @IsNotEmpty()
  managerId!: string;
}

export class UpdateEnquiryStatusDto {
  @IsIn(Object.values(EnquiryStatus))
  status!: EnquiryStatus;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

export class ListEnquiriesDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(EnquiryStatus))
  status?: EnquiryStatus;

  @IsOptional()
  assignedManagerId?: string;
}
