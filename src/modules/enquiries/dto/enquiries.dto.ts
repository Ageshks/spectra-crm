import { Transform } from 'class-transformer';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { EnquiryStatus, WorkOrderPriority } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateEnquiryDto {
  @IsOptional()
  @IsString()
  companySlug?: string;

  @IsOptional()
  @IsUUID()
  customerId?: string;

  @ValidateIf((dto) => !dto.contactName)
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  contactName?: string;

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
  companyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  company?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  requestedService?: string;

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
  message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerMessage?: string;

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
