import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { BookingsService } from './bookings.service';
import { CreateBookingDto, ListBookingsDto, UpdateBookingStatusDto } from './dto/bookings.dto';

@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Post()
  @Roles(Role.CUSTOMER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a service booking' })
  @ResponseMessage('Booking created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBookingDto) {
    return this.bookings.create(dto, user);
  }

  @Get()
  @Roles(Role.CUSTOMER, Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List bookings (customers see only their own)' })
  @ResponseMessage('Bookings retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListBookingsDto) {
    return this.bookings.list(query, user);
  }

  @Get(':id')
  @Roles(Role.CUSTOMER, Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a booking (ownership enforced)' })
  @ResponseMessage('Booking retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.getById(id, user);
  }

  @Patch(':id/status')
  @Roles(Role.CUSTOMER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Confirm / schedule / cancel a booking' })
  @ResponseMessage('Booking status updated')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBookingStatusDto,
  ) {
    return this.bookings.updateStatus(id, dto, user);
  }
}
