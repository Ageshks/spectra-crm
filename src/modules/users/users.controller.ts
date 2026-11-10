import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { CloudinaryService, validateImageFile } from '../../common/uploads/uploads.module';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { CreateAdminUserDto, ListUsersDto, UpdateMeDto, UpdateUserStatusDto } from './dto/users.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
  ) {}

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

  @Post('me/profile-photo')
  @UseInterceptors(FileInterceptor('photo', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { photo: { type: 'string', format: 'binary' } }, required: ['photo'] } })
  @ApiOperation({ summary: 'Upload or replace the authenticated user profile photo' })
  @ResponseMessage('Profile photo updated')
  async uploadProfilePhoto(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('photo file is required');
    const uploads = this.config.get<AppConfig['uploads']>('uploads');
    validateImageFile(file, uploads?.maxFileSize ?? 5 * 1024 * 1024);
    const uploaded = await this.cloudinary.uploadImage(file, 'spectra/profile-photos');
    return this.users.updateMe(user.id, { profilePhoto: uploaded.imageUrl });
  }

  @Post('admins')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create an admin account (admin-only; role is assigned by the server)' })
  @ResponseMessage('Admin account created')
  createAdmin(@CurrentUser() user: AuthUser, @Body() dto: CreateAdminUserDto) {
    return this.users.createAdmin(dto, user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.MANAGER)
  @ApiOperation({ summary: 'List users (search, filter, paginate)' })
  @ResponseMessage('Users retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListUsersDto) {
    return this.users.list(query, user);
  }

  @Get(':id')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get a single user' })
  @ResponseMessage('User retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.users.getById(id, user);
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
    return this.users.updateStatus(id, dto, user);
  }
}
