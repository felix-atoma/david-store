import { DeliveryMethod, PaymentMethod } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

const GH_PHONE = /^\+233\d{9}$/;

export class CheckoutItemDto {
  @IsString()
  variantId: string;

  @IsInt()
  @Min(1)
  @Max(20)
  quantity: number;
}

export class AddressDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  region: string;

  @IsString()
  @MinLength(2)
  @MaxLength(60)
  city: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  area: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  street?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  /** Ghana Post digital address, e.g. GA-123-4567. */
  @IsOptional()
  @Matches(/^[A-Z]{2}-?\d{3,4}-?\d{3,4}$/i, { message: 'GPS address must look like GA-123-4567' })
  gpsAddress?: string;
}

export class CreateOrderDto {
  @ValidateNested({ each: true })
  @Type(() => CheckoutItemDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  items: CheckoutItemDto[];

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @Matches(GH_PHONE, { message: 'phone must look like +233241234567' })
  phone: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsIn(Object.values(DeliveryMethod))
  deliveryMethod: DeliveryMethod;

  @ValidateIf((o: CreateOrderDto) => o.deliveryMethod === DeliveryMethod.HOME)
  @IsString()
  zoneId?: string;

  @ValidateIf((o: CreateOrderDto) => o.deliveryMethod === DeliveryMethod.HOME)
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @ValidateIf((o: CreateOrderDto) => o.deliveryMethod === DeliveryMethod.PICKUP)
  @IsString()
  pickupStationId?: string;

  /** Wallet payments come with customer accounts. */
  @IsIn([PaymentMethod.MOMO, PaymentMethod.CARD, PaymentMethod.PAY_ON_DELIVERY])
  paymentMethod: PaymentMethod;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
