import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { EarningsQueryDto } from './earnings.dto';
import { EarningsService } from './earnings.service';

@ApiTags('earnings')
@ApiBearerAuth()
@Controller('earnings')
export class EarningsController {
  constructor(private readonly earnings: EarningsService) {}

  @Get()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Summarize paid overtime and approved expense reimbursements' })
  @ResponseMessage('Earnings summary retrieved')
  summary(@CurrentUser() user: AuthUser, @Query() query: EarningsQueryDto) {
    return this.earnings.summary(query, user);
  }
}
