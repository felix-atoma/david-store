import { ProductStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** Photos are ones uploaded through /admin/media, the shipped ones in /products, or a full https link. */
const IMAGE_URL = /^(\/api\/media\/[a-z0-9]+\.webp|\/products\/[\w.-]+|https:\/\/\S+)$/;

export class ProductImageDto {
  @Matches(IMAGE_URL, { message: 'image url must be an uploaded photo' })
  url: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  alt?: string;
}

export class VariantDto {
  /** Present when editing an existing variant. */
  @IsOptional()
  @IsString()
  id?: string;

  /** What the shopper picks, e.g. "Black" or "Pro / 256GB". */
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name: string;

  /** Left empty, one is made up from the product name. */
  @IsOptional()
  @Matches(/^[A-Z0-9][A-Z0-9-]{1,63}$/i, { message: 'SKU may use letters, numbers and dashes' })
  sku?: string;

  /** Pesewas. */
  @IsInt()
  @Min(100, { message: 'Price must be at least GH₵1' })
  @Max(100_000_000)
  price: number;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  oldPrice?: number | null;

  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10_000)
  lowStockThreshold?: number;
}

const STATUSES = [ProductStatus.DRAFT, ProductStatus.PUBLISHED, ProductStatus.SCHEDULED, ProductStatus.HIDDEN] as const;

export class SaveProductDto {
  @IsString()
  @MinLength(3)
  @MaxLength(150)
  name: string;

  @IsString()
  categoryId: string;

  /** Brand name; created on the fly if new. Empty for unbranded items. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  brand?: string;

  @IsString()
  @MinLength(10, { message: 'Write at least a sentence of description' })
  @MaxLength(6000)
  description: string;

  @IsArray()
  @ArrayMaxSize(12)
  @IsString({ each: true })
  @MaxLength(160, { each: true })
  keyFeatures: string[];

  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  inTheBox: string[];

  /** Values for the category's fields, keyed by field key. */
  @IsObject()
  specs: Record<string, unknown>;

  @IsArray()
  @ArrayMaxSize(8, { message: 'Up to 8 photos per product' })
  @ValidateNested({ each: true })
  @Type(() => ProductImageDto)
  images: ProductImageDto[];

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants: VariantDto[];

  @IsIn(STATUSES)
  status: (typeof STATUSES)[number];

  @ValidateIf((o: SaveProductDto) => o.status === ProductStatus.SCHEDULED)
  @IsISO8601({}, { message: 'Pick the date and time to publish' })
  publishAt?: string;

  @IsOptional()
  @IsBoolean()
  freeDelivery?: boolean;

  @IsOptional()
  @IsBoolean()
  isFeatured?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== '' && v !== null)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { message: 'Video link must start with https://' })
  videoUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  warranty?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(70)
  seoTitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(170)
  seoDescription?: string | null;
}

export class QuickEditDto {
  /** Pesewas; single-variant products only. */
  @IsOptional()
  @IsInt()
  @Min(100)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;

  @IsOptional()
  @IsIn([...STATUSES, ProductStatus.ARCHIVED])
  status?: ProductStatus;
}

export class ProductListQuery {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  @IsOptional()
  @IsIn(['ALL', ...Object.values(ProductStatus)])
  status?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
}
