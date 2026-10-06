import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/utils/transformers';

export class UpdateMeDto {
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
  @MaxLength(500)
  profilePhoto?: string;
}

export class ListUsersDto extends PaginationDto {
  @IsOptional()
  @IsIn(Object.values(Role))
  role?: Role;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateUserStatusDto {
  @IsBoolean()
  isActive!: boolean;
}
