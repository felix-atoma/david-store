import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';

/** Ghana numbers in E.164, e.g. +233241234567. */
const GH_PHONE = /^\+233\d{9}$/;

export class RegisterDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  /** Email or phone is required; both are allowed. */
  @ValidateIf((o: RegisterDto) => !o.phone || o.email !== undefined)
  @IsEmail()
  email?: string;

  @IsOptional()
  @Matches(GH_PHONE, { message: 'phone must look like +233241234567' })
  phone?: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(10, { message: 'New password must be at least 10 characters' })
  @MaxLength(128)
  @Matches(/(?=.*[A-Za-z])(?=.*\d)/, { message: 'New password must contain letters and at least one number' })
  newPassword: string;
}

export class LoginDto {
  /** Email address or phone number. */
  @IsString()
  @MaxLength(120)
  identifier: string;

  @IsString()
  @MaxLength(128)
  password: string;
}
