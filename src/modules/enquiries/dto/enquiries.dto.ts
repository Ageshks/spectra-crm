import { IsIn, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { EnquiryStatus } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateEnquiryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @Matches(/^\+?[0-9][0-9\s\-]{6,14}[0-9]$/, { message: 'phone must be a valid phone number' })
  phone!: string;

  @IsOptional()
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be a valid email address' })
  email?: string;

  @IsOptional()
  @IsString()
  serviceId?: string;

  @IsOptional()
  @IsString()
  serviceLocationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  message?: string;
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
