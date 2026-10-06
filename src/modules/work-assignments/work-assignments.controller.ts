import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { WorkAssignmentsService } from './work-assignments.service';
import { WorkTransfersService } from './work-transfers.service';
import {
  AssignmentActionDto,
  CreateAssignmentDto,
  CreateTransferDto,
  ListAssignmentsDto,
  ListTransfersDto,
  TransferDecisionDto,
} from './dto/work-assignments.dto';

@ApiTags('work-assignments')
@ApiBearerAuth()
@Controller('work-assignments')
export class WorkAssignmentsController {
  constructor(private readonly assignments: WorkAssignmentsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Assign one or more technicians to a work order' })
  @ResponseMessage('Technicians assigned')
  assign(@CurrentUser() user: AuthUser, @Body() dto: CreateAssignmentDto) {
    return this.assignments.assign(dto, user);
  }

  @Get()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List assignments (employees see their own)' })
  @ResponseMessage('Assignments retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListAssignmentsDto) {
    return this.assignments.list(query, user);
  }

  @Post(':id/accept')
  @Roles(Role.EMPLOYEE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Employee accepts assigned work' })
  @ResponseMessage('Work accepted')
  accept(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentActionDto,
  ) {
    return this.assignments.accept(id, user, dto);
  }

  @Post(':id/start')
  @Roles(Role.EMPLOYEE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Employee starts accepted work' })
  @ResponseMessage('Work started')
  start(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentActionDto,
  ) {
    return this.assignments.start(id, user, dto);
  }

  @Post(':id/complete')
  @Roles(Role.EMPLOYEE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Employee completes field work' })
  @ResponseMessage('Work completed')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentActionDto,
  ) {
    return this.assignments.complete(id, user, dto);
  }

  @Post(':id/cancel')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Cancel an assignment (managers only — employees cannot reject work)' })
  @ResponseMessage('Assignment cancelled')
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignmentActionDto,
  ) {
    return this.assignments.cancel(id, user, dto);
  }
}

@ApiTags('work-transfers')
@ApiBearerAuth()
@Controller('work-transfers')
export class WorkTransfersController {
  constructor(private readonly transfers: WorkTransfersService) {}

  @Post()
  @Roles(Role.EMPLOYEE)
  @ApiOperation({ summary: 'Request a work transfer (reason required)' })
  @ResponseMessage('Transfer requested')
  request(@CurrentUser() user: AuthUser, @Body() dto: CreateTransferDto) {
    return this.transfers.request(dto, user);
  }

  @Get()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List transfer requests (role scoped)' })
  @ResponseMessage('Transfers retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListTransfersDto) {
    return this.transfers.list(query, user);
  }

  @Get(':id')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a transfer request' })
  @ResponseMessage('Transfer retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.getById(id);
  }

  @Patch(':id/decision')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Approve or reject a transfer (managers only)' })
  @ResponseMessage('Transfer decision recorded')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TransferDecisionDto,
  ) {
    return this.transfers.decide(id, dto, user);
  }
}
