import { PASSWORD_MIN_LENGTH } from '../../../common/constants';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;
const PHONE_PATTERN = /^\+?[0-9][0-9\s\-]{6,14}[0-9]$/;

export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsOptional()
  @Matches(PHONE_PATTERN, { message: 'phone must be a valid phone number' })
  phone?: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  @Matches(PASSWORD_PATTERN, {
    message: 'password must contain at least one uppercase letter, one lowercase letter and one number',
  })
  password!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RefreshTokenDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;
}

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  @Matches(PASSWORD_PATTERN, {
    message: 'newPassword must contain at least one uppercase letter, one lowercase letter and one number',
  })
  newPassword!: string;
}

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(72)
  @Matches(PASSWORD_PATTERN, {
    message: 'newPassword must contain at least one uppercase letter, one lowercase letter and one number',
  })
  newPassword!: string;
}
