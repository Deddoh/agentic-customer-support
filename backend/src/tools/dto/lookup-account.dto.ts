import { IsEmail, IsString, Matches, MaxLength } from 'class-validator';

export class LookupAccountDto {
  @IsEmail({}, { message: 'A valid customer email address is required.' })
  @MaxLength(120)
  email: string;

  @IsString()
  @Matches(/^\+?[0-9]{9,15}$/, {
    message: 'Phone number must contain 9 to 15 digits (optional leading +).',
  })
  phone: string;
}
