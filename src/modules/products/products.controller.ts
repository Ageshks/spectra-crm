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
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { CreateProductDto, ListProductsDto, UpdateProductDto } from './dto/products.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @UseInterceptors(
    FilesInterceptor('photos', 2, {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 2 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
        companyId: { type: 'string', format: 'uuid' },
        photos: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
      required: ['name', 'price'],
    },
  })
  @ApiOperation({ summary: 'Create a product with up to two photos' })
  @ResponseMessage('Product created')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.products.create(dto, files, user);
  }

  @Get()
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Browse active products (public)' })
  @ResponseMessage('Products retrieved')
  list(@CurrentUser() user: AuthUser | undefined, @Query() query: ListProductsDto) {
    if (user && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.SUPER_ADMIN)) {
      return this.products.list(query, user);
    }
    return this.products.listPublic(query);
  }

  @Get(':id')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get an active product (public)' })
  @ResponseMessage('Product retrieved')
  get(@CurrentUser() user: AuthUser | undefined, @Param('id', ParseUUIDPipe) id: string) {
    if (user && (user.role === Role.ADMIN || user.role === Role.MANAGER || user.role === Role.SUPER_ADMIN)) {
      return this.products.getById(id, user);
    }
    return this.products.getPublicById(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @UseInterceptors(
    FilesInterceptor('photos', 2, {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024, files: 2 },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        price: { type: 'number' },
        isActive: { type: 'boolean' },
        photos: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiOperation({ summary: 'Update product details; uploaded photos replace the existing photos' })
  @ResponseMessage('Product updated')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ) {
    return this.products.update(id, dto, files, user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Delete a product' })
  @ResponseMessage('Product deleted')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.products.remove(id, user);
  }
}
