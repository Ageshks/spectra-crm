import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class UploadWorkPhotoDto {
  @IsUUID('4')
  workOrderId!: string;

  @IsOptional()
  @IsUUID('4')
  serviceReportId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

export class ListWorkPhotosDto extends PaginationDto {
  @IsOptional()
  @IsUUID('4')
  workOrderId?: string;

  @IsOptional()
  @IsUUID('4')
  serviceReportId?: string;
}
