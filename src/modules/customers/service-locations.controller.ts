import { Body, Controller, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { CustomersService } from './customers.service';
import { CreateServiceLocationDto } from './dto/customers.dto';

@ApiTags('service-locations')
@ApiBearerAuth()
@Controller('service-locations')
export class ServiceLocationsController {
  constructor(private readonly customers: CustomersService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a service location for a customer' })
  @ResponseMessage('Service location created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateServiceLocationDto) {
    const { customerId, ...address } = dto;
    return this.customers.createAddressForCustomer(customerId, address, user.id);
  }
}
