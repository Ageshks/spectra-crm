import { Controller, Get, Post, Delete, Param, Query, Body, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { Role } from '@prisma/client';
import { ExportsService } from './exports.service';
import { CreateExportDto, ListExportsDto } from './dto/exports.dto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

@ApiTags('Exports')
@ApiBearerAuth('bearer')
@Controller('exports')
export class ExportsController {
  constructor(private readonly service: ExportsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an export job' })
  create(@Body() dto: CreateExportDto, @CurrentUser() actor: AuthUser) {
    return this.service.create(dto, actor);
  }

  @Get()
  @ApiOperation({ summary: 'List export jobs' })
  list(@Query() query: ListExportsDto, @CurrentUser() actor: AuthUser) {
    return this.service.list(query, actor);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get export job status' })
  get(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.service.get(id, actor);
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Download a completed export' })
  async download(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const { absolutePath, filename, mimeType } = await this.service.download(id, actor);
    const stats = await stat(absolutePath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = createReadStream(absolutePath);
    stream.pipe(res);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an export job and its file' })
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) {
    return this.service.remove(id, actor);
  }
}