import { PRODUCT_SORTS, type ProductSort } from '@david-store/shared';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ProductQueryDto {
  /** Category slug; products in its sub-categories are included. */
  @IsOptional()
  @IsString()
  category?: string;

  /** Comma-separated brand slugs. */
  @IsOptional()
  @IsString()
  brand?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;

  /**
   * Category spec filters, `|`-separated: `batteryHours:10-20|ipRating:IPX7,IP67`.
   * Numbers take a `min-max` range (either end may be empty); options take a comma list.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  spec?: string;

  /** Pesewas. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  minRating?: number;

  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize = 24;
}
