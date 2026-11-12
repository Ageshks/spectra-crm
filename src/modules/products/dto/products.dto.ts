import { Type } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import { ToBoolean } from '../../../common/utils/transformers';

export class CreateProductDto {
  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price!: number;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  price?: number;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}

export class ListProductsDto extends PaginationDto {
  @IsOptional()
  @IsString()
  companySlug?: string;

  @IsOptional()
  @IsUUID()
  companyId?: string;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isActive?: boolean;
}
