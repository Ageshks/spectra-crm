import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { InvoiceAdjustmentType, InvoiceItemCategory, ServiceInvoiceStatus } from '@prisma/client';

export class InvoiceItemInputDto {
  @IsEnum(InvoiceItemCategory)
  category!: InvoiceItemCategory;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  description!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0.001)
  @Max(100000)
  quantity!: number;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100000000)
  unitPrice!: number;
}

export class CreateInvoiceDto {
  @IsUUID()
  workOrderId!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  items?: InvoiceItemInputDto[];
}

export class UpdateInvoiceDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  discountAmount?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => InvoiceItemInputDto)
  items?: InvoiceItemInputDto[];
}

export class InvoiceDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  remarks?: string;
}

export class RejectInvoiceDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  remarks!: string;
}

export class ListInvoicesDto {
  @IsOptional()
  @IsEnum(ServiceInvoiceStatus)
  status?: ServiceInvoiceStatus;

  @IsOptional()
  @IsUUID()
  workOrderId?: string;
}

export class InvoiceAttachmentDto {
  @IsOptional()
  @IsUUID()
  invoiceItemId?: string;
}

export class UpdateBillingConfigDto {
  @IsOptional()
  @IsBoolean()
  managerCanAddCharges?: boolean;

  @IsOptional()
  @IsBoolean()
  allowSelfApproval?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^[0-9]{2}$/)
  gstStateCode?: string;
}

export class CreateInvoiceAdjustmentDto {
  @IsEnum(InvoiceAdjustmentType)
  type!: InvoiceAdjustmentType;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  amount!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}
