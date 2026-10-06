import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { ListWorkPhotosDto, UploadWorkPhotoDto } from './dto/work-photos.dto';
import { WorkPhotosService } from './work-photos.service';

@ApiTags('work-photos')
@ApiBearerAuth()
@Controller('work-photos')
export class WorkPhotosController {
  constructor(private readonly photos: WorkPhotosService) {}

  @Post()
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary' }, workOrderId: { type: 'string', format: 'uuid' }, serviceReportId: { type: 'string', format: 'uuid' }, caption: { type: 'string' } }, required: ['photo', 'workOrderId'] } })
  @ApiOperation({ summary: 'Upload a field photo (camera/gallery, JPEG/PNG/WEBP)' })
  @ResponseMessage('Photo uploaded')
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadWorkPhotoDto, @CurrentUser() user: AuthUser) {
    return this.photos.upload(file, dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List work photos (role-scoped)' })
  @ResponseMessage('Photos retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListWorkPhotosDto) {
    return this.photos.list(query, user);
  }

  @Delete(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a work photo' })
  @ResponseMessage('Photo deleted')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.photos.remove(id, user);
  }
}
