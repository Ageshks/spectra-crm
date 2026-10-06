import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { WorkOrdersService } from './work-orders.service';
import {
  CreateWorkOrderDto,
  ListWorkOrdersDto,
  SetManagerDto,
  UpdatePriorityDto,
  UpdateScheduleDto,
  UpdateWorkOrderStatusDto,
} from './dto/work-orders.dto';

@ApiTags('work-orders')
@ApiBearerAuth()
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a work order from a confirmed/scheduled booking' })
  @ResponseMessage('Work order created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateWorkOrderDto) {
    return this.workOrders.createFromBooking(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List work orders (role scoped, search, paginate)' })
  @ResponseMessage('Work orders retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListWorkOrdersDto) {
    return this.workOrders.list(query, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a work order (ownership enforced)' })
  @ResponseMessage('Work order retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.getById(id, user);
  }

  @Get(':id/status-history')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Full status transition history of a work order' })
  @ResponseMessage('Status history retrieved')
  statusHistory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.statusHistory(id, user);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Change work order status (validated transitions only)' })
  @ResponseMessage('Work order status updated')
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkOrderStatusDto,
  ) {
    return this.workOrders.changeStatus(id, dto, user);
  }

  @Patch(':id/schedule')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Reschedule a work order (notifies technicians)' })
  @ResponseMessage('Schedule updated')
  updateSchedule(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateScheduleDto,
  ) {
    return this.workOrders.updateSchedule(id, dto, user);
  }

  @Patch(':id/manager')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Assign a manager to a work order' })
  @ResponseMessage('Manager assigned')
  setManager(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetManagerDto,
  ) {
    return this.workOrders.setManager(id, dto, user);
  }

  @Patch(':id/priority')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update work order priority' })
  @ResponseMessage('Priority updated')
  updatePriority(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePriorityDto,
  ) {
    return this.workOrders.updatePriority(id, dto, user);
  }
}
