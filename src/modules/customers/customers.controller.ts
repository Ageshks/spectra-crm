import {
  Body,
  Controller,
  Delete,
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
import { AuthUser } from '../../common/types/auth.types';
import {
  CreateAddressDto,
  CreateCustomerDto,
  ListCustomersDto,
  UpdateAddressDto,
  UpdateCustomerDto,
} from './dto/customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  // ---------------------------------------------------------------
  // Admin / manager management
  // ---------------------------------------------------------------

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List customers (search, paginate)' })
  @ResponseMessage('Customers retrieved')
  list(@Query() query: ListCustomersDto) {
    return this.customers.list(query);
  }

  @Post()
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a customer account' })
  @ResponseMessage('Customer created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCustomerDto) {
    return this.customers.create(dto, user.id);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get customer with service locations' })
  @ResponseMessage('Customer retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.customers.getById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update customer details' })
  @ResponseMessage('Customer updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomerDto,
  ) {
    return this.customers.updateAdmin(id, dto, user.id);
  }

  // ---------------------------------------------------------------
  // Self service (customer app)
  // ---------------------------------------------------------------

  @Get('me/profile')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Own customer profile with locations' })
  @ResponseMessage('Profile retrieved')
  me(@CurrentUser() user: AuthUser) {
    return this.customers.getByUserId(user.id);
  }

  @Patch('me/profile')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Update own profile' })
  @ResponseMessage('Profile updated')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateCustomerDto) {
    return this.customers.updateByUserId(user.id, dto, user.id);
  }

  @Get('me/addresses')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Own service locations' })
  @ResponseMessage('Service locations retrieved')
  myAddresses(@CurrentUser() user: AuthUser) {
    return this.customers.listAddresses(user.id);
  }

  @Post('me/addresses')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Add a service location' })
  @ResponseMessage('Service location created')
  createAddress(@CurrentUser() user: AuthUser, @Body() dto: CreateAddressDto) {
    return this.customers.createAddress(user.id, dto, user.id);
  }

  @Patch('me/addresses/:addressId')
  @Roles(Role.CUSTOMER)
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiOperation({ summary: 'Update a service location' })
  @ResponseMessage('Service location updated')
  updateAddress(
    @CurrentUser() user: AuthUser,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.customers.updateAddress(user.id, addressId, dto, user.id);
  }

  @Delete('me/addresses/:addressId')
  @Roles(Role.CUSTOMER)
  @ApiParam({ name: 'addressId', format: 'uuid' })
  @ApiOperation({ summary: 'Deactivate a service location (soft delete)' })
  @ResponseMessage('Service location deactivated')
  deleteAddress(
    @CurrentUser() user: AuthUser,
    @Param('addressId', ParseUUIDPipe) addressId: string,
  ) {
    return this.customers.deactivateAddress(user.id, addressId, user.id);
  }

  @Get('me/service-history')
  @Roles(Role.CUSTOMER)
  @ApiOperation({ summary: 'Own service history (bookings, reports, photos, maintenance)' })
  @ResponseMessage('Service history retrieved')
  serviceHistory(@CurrentUser() user: AuthUser, @Query() query: PaginationDto) {
    return this.customers.serviceHistory(user.id, query);
  }
}
