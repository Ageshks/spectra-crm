import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { CreateManagerDto, ListManagersDto, UpdateManagerDto } from './dto/managers.dto';
import { ManagersService } from './managers.service';

@ApiTags('managers')
@ApiBearerAuth()
@Controller('managers')
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
export class ManagersController {
  constructor(private readonly managers: ManagersService) {}

  @Get()
  @ApiOperation({ summary: 'List managers' })
  @ResponseMessage('Managers retrieved')
  list(@Query() query: ListManagersDto) {
    return this.managers.list(query);
  }

  @Post()
  @ApiOperation({ summary: 'Create a manager account' })
  @ResponseMessage('Manager created')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateManagerDto) {
    return this.managers.create(dto, user.id);
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a manager' })
  @ResponseMessage('Manager retrieved')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.managers.getById(id);
  }

  @Patch(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Update a manager' })
  @ResponseMessage('Manager updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateManagerDto,
  ) {
    return this.managers.update(id, dto, user.id);
  }

  @Patch(':id/status')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Activate / deactivate a manager' })
  @ResponseMessage('Manager status updated')
  setStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: { isActive: boolean },
  ) {
    return this.managers.setStatus(id, dto.isActive, user.id);
  }
}
