import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { CreateLeaveDto, LeaveDecisionDto, ListLeaveDto } from './dto/leave.dto';
import { LeaveService } from './leave.service';

@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave')
export class LeaveController {
  constructor(private readonly leave: LeaveService) {}

  @Post()
  @Roles(Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Apply for leave' })
  @ResponseMessage('Leave request submitted')
  apply(@CurrentUser() user: AuthUser, @Body() dto: CreateLeaveDto) {
    return this.leave.apply(dto, user);
  }

  @Get()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List leave requests (employees see only their own)' })
  @ResponseMessage('Leave retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListLeaveDto) {
    return this.leave.list(query, user);
  }

  @Get(':id')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a leave request' })
  @ResponseMessage('Leave retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leave.getById(id, user);
  }

  @Post(':id/decision')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Approve or reject leave (manager only)' })
  @ResponseMessage('Leave decision recorded')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LeaveDecisionDto,
  ) {
    return this.leave.decide(id, dto, user);
  }
}
