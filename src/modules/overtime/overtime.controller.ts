import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateOvertimeDto,
  ListOvertimeDto,
  OvertimeDecisionDto,
  RecordOvertimePaymentDto,
} from './dto/overtime.dto';
import { OvertimeService } from './overtime.service';

@ApiTags('overtime')
@ApiBearerAuth()
@Controller('overtime')
export class OvertimeController {
  constructor(private readonly overtime: OvertimeService) {}

  @Post()
  @Roles(Role.EMPLOYEE, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Request overtime (duration computed server-side from attendance)' })
  @ResponseMessage('Overtime requested')
  request(@CurrentUser() user: AuthUser, @Body() dto: CreateOvertimeDto) {
    return this.overtime.request(dto, user);
  }

  @Get()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List overtime entries (employees see only their own)' })
  @ResponseMessage('Overtime retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListOvertimeDto) {
    return this.overtime.list(query, user);
  }

  @Get(':id')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get an overtime entry' })
  @ResponseMessage('Overtime retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.overtime.getById(id, user);
  }

  @Post(':id/decision')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Approve or reject overtime (manager only)' })
  @ResponseMessage('Overtime decision recorded')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OvertimeDecisionDto,
  ) {
    return this.overtime.decide(id, dto, user);
  }

  @Patch(':id/payment')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Record payment for approved overtime (admin only)' })
  @ResponseMessage('Overtime payment recorded')
  recordPayment(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordOvertimePaymentDto,
  ) {
    return this.overtime.recordPayment(id, dto, user);
  }
}
