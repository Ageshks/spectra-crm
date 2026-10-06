import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { CreateServiceDto, ListServicesDto, UpdateServiceDto } from './dto/services.dto';
import { ServicesService } from './services.service';

@ApiTags('services')
@ApiBearerAuth()
@Controller('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Browse active services (public)' })
  @ResponseMessage('Services retrieved')
  list(@Query() query: ListServicesDto) {
    return this.services.list({ ...query, isActive: query.isActive ?? true });
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a service' })
  @ResponseMessage('Service created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceDto) {
    return this.services.create(dto, user.id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a service' })
  @ResponseMessage('Service retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.services.getById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a service' })
  @ResponseMessage('Service updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceDto,
  ) {
    return this.services.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Activate / deactivate a service' })
  @ResponseMessage('Service status updated')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { isActive: boolean },
  ) {
    return this.services.setStatus(id, dto.isActive, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a service when safe, otherwise deactivate' })
  @ResponseMessage('Service removed')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.services.remove(id, user.id);
  }
}
