import { Body, Controller, Get, Param, ParseIntPipe, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { SaveWorkingCalendarDto } from './working-calendar.dto';
import { WorkingCalendarService } from './working-calendar.service';

@ApiTags('working-calendar')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.SUPER_ADMIN)
@Controller('working-calendar')
export class WorkingCalendarController {
  constructor(private readonly calendar: WorkingCalendarService) {}

  @Get(':year')
  @ApiParam({ name: 'year', example: 2026 })
  @ApiOperation({ summary: 'Get the working calendar for a year' })
  @ResponseMessage('Working calendar retrieved')
  get(@Param('year', ParseIntPipe) year: number) {
    return this.calendar.get(year);
  }

  @Put(':year')
  @ApiParam({ name: 'year', example: 2026 })
  @ApiOperation({ summary: 'Save working days, holidays, and calendar events' })
  @ResponseMessage('Working calendar saved')
  save(
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: SaveWorkingCalendarDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.calendar.save(year, dto, actor);
  }
}
