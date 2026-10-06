import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength, IsNotEmpty } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../../../common/constants';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateManagerDto {
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
  @Matches(/^\+?[0-9][0-9\s\-]{6,14}[0-9]$/, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;
}

export class UpdateManagerDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @Matches(/^\+?[0-9][0-9\s\-]{6,14}[0-9]$/, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListManagersDto extends PaginationDto {}
