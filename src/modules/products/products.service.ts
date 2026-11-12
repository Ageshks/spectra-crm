import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { normalizePagination, paginated, PaginatedResult, safeOrderBy } from '../../common/utils/pagination.util';
import { CloudinaryService, validateImageFile } from '../../common/uploads/uploads.module';
import { AuthUser } from '../../common/types/auth.types';
import { PrismaService } from '../../database/prisma.service';
import { CreateProductDto, ListProductsDto, UpdateProductDto } from './dto/products.dto';

const productInclude = {
  photos: {
    select: { id: true, imageUrl: true, thumbnailUrl: true, position: true, createdAt: true },
    orderBy: { position: 'asc' as const },
  },
} satisfies Prisma.ProductInclude;

const PRODUCT_PHOTO_LIMIT = 2;
const MAX_PHOTO_SIZE = 5 * 1024 * 1024;
const PRODUCT_UPLOAD_FOLDER = 'spectra/products';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cloudinary: CloudinaryService,
  ) {}

  private companyScope(actor: AuthUser): Prisma.ProductWhereInput {
    return actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' };
  }

  private async uploadPhotos(
    files: Express.Multer.File[],
  ): Promise<Awaited<ReturnType<CloudinaryService['uploadImage']>>[]> {
    if (files.length > PRODUCT_PHOTO_LIMIT) {
      throw new BadRequestException(`A product can have up to ${PRODUCT_PHOTO_LIMIT} photos`);
    }
    const uploaded: Awaited<ReturnType<CloudinaryService['uploadImage']>>[] = [];
    try {
      for (const file of files) {
        validateImageFile(file, MAX_PHOTO_SIZE);
        uploaded.push(await this.cloudinary.uploadImage(file, PRODUCT_UPLOAD_FOLDER));
      }
      return uploaded;
    } catch (error) {
      await Promise.all(uploaded.map((photo) => this.cloudinary.deleteImage(photo.publicId)));
      throw error;
    }
  }

  async listPublic(query: ListProductsDto): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.ProductWhereInput = {
      isActive: true,
      company: {
        isActive: true,
        slug: query.companySlug?.trim().toLowerCase() || 'default',
      },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'name', 'price']),
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(products, page, limit, total);
  }

  async list(query: ListProductsDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    if (actor.role !== Role.SUPER_ADMIN && query.companyId && query.companyId !== actor.companyId) {
      throw new ForbiddenException('You cannot view products from another company');
    }
    const { skip, take, page, limit, sortBy, sortOrder, search } = normalizePagination(query);
    const where: Prisma.ProductWhereInput = {
      ...this.companyScope(actor),
      ...(actor.role === Role.SUPER_ADMIN && query.companyId ? { companyId: query.companyId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [products, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt', 'name', 'price']),
        include: productInclude,
      }),
      this.prisma.product.count({ where }),
    ]);
    return paginated(products, page, limit, total);
  }

  async getById(id: string, actor: AuthUser): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id, ...this.companyScope(actor) },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async getPublicById(id: string): Promise<unknown> {
    const product = await this.prisma.product.findFirst({
      where: { id, isActive: true, company: { isActive: true } },
      include: productInclude,
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(dto: CreateProductDto, files: Express.Multer.File[] | undefined, actor: AuthUser): Promise<unknown> {
    const companyId = actor.role === Role.SUPER_ADMIN ? (dto.companyId ?? actor.companyId) : actor.companyId;
    if (!companyId) throw new BadRequestException('An active company is required to create a product');
    if (actor.role !== Role.SUPER_ADMIN && dto.companyId && dto.companyId !== companyId) {
      throw new ForbiddenException('You cannot create products in another company');
    }
    const company = await this.prisma.company.findFirst({
      where: { id: companyId, isActive: true },
      select: { id: true },
    });
    if (!company) throw new BadRequestException('An active company is required to create a product');

    const uploaded = await this.uploadPhotos(files ?? []);
    try {
      const product = await this.prisma.product.create({
        data: {
          companyId,
          name: dto.name.trim(),
          description: dto.description?.trim() || undefined,
          price: dto.price,
          photos: {
            create: uploaded.map((photo, position) => ({
              imageUrl: photo.imageUrl,
              thumbnailUrl: photo.thumbnailUrl,
              publicId: photo.publicId,
              position,
            })),
          },
        },
        include: productInclude,
      });
      await this.audit.log({
        action: 'CREATE_PRODUCT',
        module: 'products',
        entity: 'Product',
        entityId: product.id,
        userId: actor.id,
        newValues: { name: product.name, price: Number(product.price), photoCount: uploaded.length },
      });
      return product;
    } catch (error) {
      await Promise.all(uploaded.map((photo) => this.cloudinary.deleteImage(photo.publicId)));
      throw error;
    }
  }

  async update(
    id: string,
    dto: UpdateProductDto,
    files: Express.Multer.File[] | undefined,
    actor: AuthUser,
  ): Promise<unknown> {
    const existing = await this.prisma.product.findFirst({
      where: { id, ...this.companyScope(actor) },
      include: { photos: { select: { publicId: true } } },
    });
    if (!existing) throw new NotFoundException('Product not found');
    if (
      dto.name === undefined &&
      dto.description === undefined &&
      dto.price === undefined &&
      dto.isActive === undefined &&
      !files?.length
    ) {
      throw new BadRequestException('Provide product fields or replacement photos to update');
    }

    const uploaded = files?.length ? await this.uploadPhotos(files) : undefined;
    try {
      const product = await this.prisma.$transaction(async (tx) => {
        await tx.product.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...(dto.description !== undefined ? { description: dto.description.trim() || null } : {}),
            ...(dto.price !== undefined ? { price: dto.price } : {}),
            ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
          },
        });
        if (uploaded) {
          await tx.productPhoto.deleteMany({ where: { productId: id } });
          if (uploaded.length) {
            await tx.productPhoto.createMany({
              data: uploaded.map((photo, position) => ({
                productId: id,
                imageUrl: photo.imageUrl,
                thumbnailUrl: photo.thumbnailUrl,
                publicId: photo.publicId,
                position,
              })),
            });
          }
        }
        return tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });
      });
      if (uploaded) {
        await Promise.all(existing.photos.map((photo) => this.cloudinary.deleteImage(photo.publicId)));
      }
      await this.audit.log({
        action: 'UPDATE_PRODUCT',
        module: 'products',
        entity: 'Product',
        entityId: id,
        userId: actor.id,
        newValues: {
          ...dto,
          ...(uploaded ? { photoCount: uploaded.length } : {}),
        } as Prisma.InputJsonValue,
      });
      return product;
    } catch (error) {
      if (uploaded) {
        await Promise.all(uploaded.map((photo) => this.cloudinary.deleteImage(photo.publicId)));
      }
      throw error;
    }
  }

  async remove(id: string, actor: AuthUser): Promise<{ id: string; deleted: true }> {
    const product = await this.prisma.product.findFirst({
      where: { id, ...this.companyScope(actor) },
      include: { photos: { select: { publicId: true } } },
    });
    if (!product) throw new NotFoundException('Product not found');
    await this.prisma.product.delete({ where: { id } });
    await Promise.all(product.photos.map((photo) => this.cloudinary.deleteImage(photo.publicId)));
    await this.audit.log({
      action: 'DELETE_PRODUCT',
      module: 'products',
      entity: 'Product',
      entityId: id,
      userId: actor.id,
      oldValues: { name: product.name },
    });
    return { id, deleted: true };
  }
}
