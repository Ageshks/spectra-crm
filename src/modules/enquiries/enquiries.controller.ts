import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { IsDateString, IsOptional, IsString, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import {
  AssignEnquiryDto,
  CreateEnquiryDto,
  ListEnquiriesDto,
  UpdateEnquiryStatusDto,
} from './dto/enquiries.dto';
import { EnquiriesService } from './enquiries.service';

export class ConvertEnquiryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serviceId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serviceLocationId?: string;

  @ApiProperty({ example: '2026-10-10' })
  @IsDateString({}, { message: 'preferredDate must be an ISO date' })
  preferredDate!: string;

  @ApiProperty({ example: '10:30' })
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'preferredTime must be HH:mm' })
  preferredTime!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  remarks?: string;
}

@ApiTags('enquiries')
@ApiBearerAuth()
@Controller('enquiries')
export class EnquiriesController {
  constructor(private readonly enquiries: EnquiriesService) {}

  @Public()
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit a public customer enquiry' })
  @ResponseMessage('Enquiry submitted')
  create(@CurrentUser() user: AuthUser | undefined, @Body() dto: CreateEnquiryDto) {
    return this.enquiries.create(dto, {
      id: user?.id ?? '',
      role: user?.role ?? Role.CUSTOMER,
      customerId: user?.customerId,
    });
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List enquiries (search, filter, paginate)' })
  @ResponseMessage('Enquiries retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListEnquiriesDto) {
    return this.enquiries.list(query, { id: user.id, role: user.role });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get an enquiry' })
  @ResponseMessage('Enquiry retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.enquiries.getById(id);
  }

  @Post(':id/assign')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Assign an enquiry to a manager' })
  @ResponseMessage('Enquiry assigned')
  assign(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignEnquiryDto,
  ) {
    return this.enquiries.assign(id, dto, user.id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update enquiry status' })
  @ResponseMessage('Enquiry status updated')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEnquiryStatusDto,
  ) {
    return this.enquiries.updateStatus(id, dto, user.id);
  }

  @Post(':id/convert')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Convert an enquiry into a booking' })
  @ResponseMessage('Enquiry converted to booking')
  convert(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConvertEnquiryDto,
  ) {
    return this.enquiries.convertToBooking(id, dto, user.id);
  }
}
