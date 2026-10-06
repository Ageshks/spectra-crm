import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { AttendanceService } from './attendance.service';
import { CheckInDto, CheckOutDto, ListAttendanceDto } from './dto/attendance.dto';

@ApiTags('attendance')
@ApiBearerAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Post('check-in')
  @HttpCode(200)
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  @ApiOperation({ summary: 'Staff check-in (server timestamp, GPS when enabled)' })
  @ResponseMessage('Checked in')
  checkIn(@CurrentUser() user: AuthUser, @Body() dto: CheckInDto) {
    return this.attendance.checkIn(dto, user);
  }

  @Post('check-out')
  @HttpCode(200)
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  @ApiOperation({ summary: 'Staff check-out (server-side duration)' })
  @ResponseMessage('Checked out')
  checkOut(@CurrentUser() user: AuthUser, @Body() dto: CheckOutDto) {
    return this.attendance.checkOut(dto, user);
  }

  @Get('today')
  @Roles(Role.EMPLOYEE, Role.MANAGER)
  @ApiOperation({ summary: "Today's attendance record for the current staff member" })
  @ResponseMessage('Attendance retrieved')
  today(@CurrentUser() user: AuthUser) {
    return this.attendance.today(user);
  }

  @Get()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List attendance records (employees see only their own)' })
  @ResponseMessage('Attendance retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListAttendanceDto) {
    return this.attendance.list(query, user);
  }

  @Get(':id')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get an attendance record' })
  @ResponseMessage('Attendance retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.attendance.getById(id, user);
  }
}
