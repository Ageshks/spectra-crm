import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { RangeQueryDto } from '../../common/dto/range-query.dto';
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateEmployeeDto,
  ListEmployeesDto,
  UpdateEmployeeDto,
} from './dto/employees.dto';
import { EmployeesService } from './employees.service';

@ApiTags('employees')
@ApiBearerAuth()
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get('me')
  @Roles(Role.EMPLOYEE)
  @ApiOperation({ summary: 'Own employee profile' })
  @ResponseMessage('Profile retrieved')
  me(@CurrentUser() user: AuthUser) {
    return this.employees.getByUserId(user.id);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List employees (search, filter, paginate)' })
  @ResponseMessage('Employees retrieved')
  list(@Query() query: ListEmployeesDto) {
    return this.employees.list(query);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create an employee account' })
  @ResponseMessage('Employee created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEmployeeDto) {
    return this.employees.create(dto, user.id);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get an employee' })
  @ResponseMessage('Employee retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.employees.getById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update an employee' })
  @ResponseMessage('Employee updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ) {
    return this.employees.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Activate / deactivate an employee' })
  @ResponseMessage('Employee status updated')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { isActive: boolean },
  ) {
    return this.employees.setStatus(id, dto.isActive, user.id);
  }

  @Get(':id/work-orders')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Work assigned to an employee' })
  @ResponseMessage('Assigned work retrieved')
  assignedWork(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationDto) {
    return this.employees.assignedWork(id, query);
  }

  @Get(':id/attendance')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Attendance records of an employee' })
  @ResponseMessage('Attendance retrieved')
  attendance(@Param('id', ParseUUIDPipe) id: string, @Query() query: RangeQueryDto) {
    return this.employees.attendance(id, query);
  }

  @Get(':id/overtime')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Overtime records of an employee' })
  @ResponseMessage('Overtime retrieved')
  overtime(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationDto) {
    return this.employees.overtimes(id, query);
  }

  @Get(':id/leave')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Leave records of an employee' })
  @ResponseMessage('Leave retrieved')
  leave(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationDto) {
    return this.employees.leaves(id, query);
  }

  @Get(':id/reports')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Service reports submitted by an employee' })
  @ResponseMessage('Reports retrieved')
  reports(@Param('id', ParseUUIDPipe) id: string, @Query() query: PaginationDto) {
    return this.employees.reports(id, query);
  }
}
