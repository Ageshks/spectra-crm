import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('admin')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Admin overview: customers, bookings, work orders, maintenance, workforce' })
  @ResponseMessage('Admin dashboard retrieved')
  admin() {
    return this.dashboard.admin();
  }

  @Get('manager')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Manager overview scoped to assigned work' })
  @ResponseMessage('Manager dashboard retrieved')
  manager(@CurrentUser() user: AuthUser) {
    return this.dashboard.manager(user);
  }

  @Get('employee')
  @Roles(Role.EMPLOYEE)
  @ApiOperation({ summary: 'Employee overview: today attendance + assigned work' })
  @ResponseMessage('Employee dashboard retrieved')
  employee(@CurrentUser() user: AuthUser) {
    return this.dashboard.employee(user);
  }

  @Get('customer')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Customer overview: bookings, history, upcoming maintenance' })
  @ResponseMessage('Customer dashboard retrieved')
  customer(@CurrentUser() user: AuthUser) {
    return this.dashboard.customer(user);
  }
}
