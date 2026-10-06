import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateMaintenanceDto,
  ListMaintenanceDto,
  UpdateMaintenanceDto,
} from './dto/maintenance.dto';
import { MaintenanceService } from './maintenance.service';

@ApiTags('maintenance')
@ApiBearerAuth()
@Controller('maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.CUSTOMER)
  @ApiOperation({ summary: 'Create a maintenance schedule' })
  @ResponseMessage('Maintenance schedule created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateMaintenanceDto) {
    return this.maintenance.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List maintenance schedules (customers see only their own)' })
  @ResponseMessage('Maintenance schedules retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListMaintenanceDto) {
    return this.maintenance.list(query, user);
  }

  @Get('upcoming')
  @ApiOperation({ summary: 'Schedules due within the next N days (default 30)' })
  @ResponseMessage('Upcoming maintenance retrieved')
  upcoming(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.maintenance.upcoming(Number(days) || 30, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a maintenance schedule' })
  @ResponseMessage('Maintenance schedule retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.maintenance.getById(id, user);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a maintenance schedule' })
  @ResponseMessage('Maintenance schedule updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaintenanceDto,
  ) {
    return this.maintenance.update(id, dto, user);
  }

  @Post(':id/complete')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark a schedule visit complete and roll to the next date' })
  @ResponseMessage('Maintenance visit completed')
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.maintenance.complete(id, user);
  }
}
