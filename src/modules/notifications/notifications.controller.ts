import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { FcmService } from './fcm.service';
import { ListNotificationsDto, RegisterDeviceDto } from './dto/notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly fcm: FcmService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List own notifications' })
  @ResponseMessage('Notifications retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListNotificationsDto) {
    return this.notifications.list(user.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count' })
  @ResponseMessage('Unread count retrieved')
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(user.id);
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  @ResponseMessage('All notifications marked as read')
  markAllRead(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.id);
  }

  @Patch(':id/read')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Mark a notification as read' })
  @ResponseMessage('Notification marked as read')
  markRead(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  // ---------------------------------------------------------------
  // Push device tokens (Flutter apps)
  // ---------------------------------------------------------------

  @Get('devices')
  @ApiOperation({ summary: 'List registered device tokens' })
  @ResponseMessage('Devices retrieved')
  devices(@CurrentUser() user: AuthUser) {
    return this.fcm.listDevices(user.id);
  }

  @Patch('devices')
  @ApiOperation({ summary: 'Register or refresh a push device token' })
  @ResponseMessage('Device registered')
  async registerDevice(@CurrentUser() user: AuthUser, @Body() dto: RegisterDeviceDto) {
    await this.fcm.registerDevice(user.id, dto.token, dto.platform, dto.deviceName);
    return { registered: true };
  }

  @Delete('devices/:token')
  @ApiParam({ name: 'token' })
  @ApiOperation({ summary: 'Remove a push device token' })
  @ResponseMessage('Device removed')
  async removeDevice(@CurrentUser() user: AuthUser, @Param('token') token: string) {
    await this.fcm.removeDevice(user.id, token);
    return { removed: true };
  }
}
