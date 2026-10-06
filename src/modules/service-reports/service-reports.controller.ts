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
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateServiceReportDto,
  ListServiceReportsDto,
  ReportDecisionDto,
  UpdateServiceReportDto,
} from './dto/service-reports.dto';
import { ServiceReportsService } from './service-reports.service';

@ApiTags('service-reports')
@ApiBearerAuth()
@Controller('service-reports')
export class ServiceReportsController {
  constructor(private readonly reports: ServiceReportsService) {}

  @Post()
  @Roles(Role.EMPLOYEE)
  @ApiOperation({ summary: 'Employee creates a report for assigned COMPLETED field work' })
  @ResponseMessage('Service report created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceReportDto) {
    return this.reports.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'List reports (customers see only their approved reports)' })
  @ResponseMessage('Service reports retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListServiceReportsDto) {
    return this.reports.list(query, user);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a report (ownership enforced)' })
  @ResponseMessage('Service report retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getById(id, user);
  }

  @Patch(':id')
  @Roles(Role.EMPLOYEE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Employee edits a DRAFT / CORRECTION_REQUIRED report' })
  @ResponseMessage('Service report updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServiceReportDto,
  ) {
    return this.reports.update(id, dto, user);
  }

  @Post(':id/submit')
  @Roles(Role.EMPLOYEE)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Employee submits a report for manager review' })
  @ResponseMessage('Service report submitted')
  submit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDecisionDto,
  ) {
    return this.reports.submit(id, user, dto);
  }

  @Post(':id/approve')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Manager approves a submitted report' })
  @ResponseMessage('Service report approved')
  approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDecisionDto,
  ) {
    return this.reports.approve(id, user, dto);
  }

  @Post(':id/request-correction')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Manager requests corrections (employee is notified)' })
  @ResponseMessage('Correction requested')
  requestCorrection(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReportDecisionDto,
  ) {
    return this.reports.requestCorrection(id, user, dto);
  }
}
