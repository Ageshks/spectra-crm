import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { ListUsersDto, UpdateMeDto, UpdateUserStatusDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @ApiOperation({ summary: 'Own profile' })
  @ResponseMessage('Profile retrieved')
  me(@CurrentUser() user: AuthUser) {
    return this.users.getById(user.id);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own profile' })
  @ResponseMessage('Profile updated')
  updateMe(@CurrentUser() user: AuthUser, @Body() dto: UpdateMeDto) {
    return this.users.updateMe(user.id, dto);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List users (search, filter, paginate)' })
  @ResponseMessage('Users retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListUsersDto) {
    return this.users.list(query, { id: user.id, role: user.role });
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single user' })
  @ResponseMessage('User retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.users.getById(id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Activate or deactivate an account' })
  @ResponseMessage('User status updated')
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserStatusDto,
  ) {
    return this.users.updateStatus(id, dto, { id: user.id, role: user.role });
  }
}
