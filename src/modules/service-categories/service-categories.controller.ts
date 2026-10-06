import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateCategoryDto,
  ListCategoriesDto,
  UpdateCategoryDto,
} from './dto/service-categories.dto';
import { ServiceCategoriesService } from './service-categories.service';

@ApiTags('service-categories')
@ApiBearerAuth()
@Controller('service-categories')
export class ServiceCategoriesController {
  constructor(private readonly categories: ServiceCategoriesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse active service categories (public)' })
  @ResponseMessage('Categories retrieved')
  list(@Query() query: ListCategoriesDto) {
    return this.categories.list({ ...query, isActive: query.isActive ?? true });
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a service category' })
  @ResponseMessage('Category created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoryDto) {
    return this.categories.create(dto, user.id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a category' })
  @ResponseMessage('Category retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.categories.getById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a category' })
  @ResponseMessage('Category updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Deactivate a category (soft delete)' })
  @ResponseMessage('Category deactivated')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.categories.deactivate(id, user.id);
  }
}
