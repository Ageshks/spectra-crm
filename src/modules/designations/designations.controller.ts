import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateDesignationDto,
  ListDesignationsDto,
  UpdateDesignationDto,
} from './dto/designations.dto';
import { DesignationsService } from './designations.service';

@ApiTags('designations')
@ApiBearerAuth()
@Controller('designations')
export class DesignationsController {
  constructor(private readonly designations: DesignationsService) {}

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List designations for employee forms' })
  @ResponseMessage('Designations retrieved')
  list(@Query() query: ListDesignationsDto) {
    return this.designations.list({ ...query, isActive: query.isActive ?? true });
  }

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create an employee designation' })
  @ResponseMessage('Designation created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDesignationDto) {
    return this.designations.create(dto, user.id);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a designation' })
  @ResponseMessage('Designation retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.designations.getById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a designation' })
  @ResponseMessage('Designation updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDesignationDto,
  ) {
    return this.designations.update(id, dto, user.id);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Deactivate a designation' })
  @ResponseMessage('Designation deactivated')
  deactivate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.designations.deactivate(id, user.id);
  }
}
