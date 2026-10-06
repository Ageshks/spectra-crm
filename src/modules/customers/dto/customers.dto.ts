import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../../common/constants';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/utils/transformers';

const PHONE_PATTERN = /^\+?[0-9][0-9\s\-]{6,14}[0-9]$/;

export class CreateAddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  locationName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  address!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  state!: string;

  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'pincode must be a 6 digit number' })
  pincode!: string;

  @IsOptional()
  @IsNumber({}, { message: 'latitude must be a number between -90 and 90' })
  latitude?: number;

  @IsOptional()
  @IsNumber({}, { message: 'longitude must be a number between -180 and 180' })
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactPerson?: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'contactNumber must be a valid phone number' })
  contactNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MaxLength(150)
  locationName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  district?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{6}$/, { message: 'pincode must be a 6 digit number' })
  pincode?: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(150)
  contactPerson?: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'contactNumber must be a valid phone number' })
  contactNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  instructions?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCustomerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

export class CreateCustomerDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsString()
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, { message: 'email must be a valid email address' })
  email!: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  address?: CreateAddressDto;
}

export class ListCustomersDto extends PaginationDto {
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
