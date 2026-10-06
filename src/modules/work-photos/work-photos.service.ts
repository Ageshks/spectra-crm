import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { AppConfig } from '../../config/configuration';
import { normalizePagination, paginated, PaginatedResult, safeOrderBy } from '../../common/utils/pagination.util';
import { PrismaService } from '../../database/prisma.service';
import { AuthUser } from '../../common/types/auth.types';
import { CloudinaryService, validateImageFile } from '../../common/uploads/uploads.module';
import { ListWorkPhotosDto, UploadWorkPhotoDto } from './dto/work-photos.dto';

export const photoInclude = {
  workOrder: { select: { id: true, workOrderNumber: true, customerId: true } },
  serviceReport: { select: { id: true, reportNumber: true, status: true } },
  uploadedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
} satisfies Prisma.WorkPhotoInclude;

@Injectable()
export class WorkPhotosService {
  readonly maxFileSize: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    readonly cloudinary: CloudinaryService,
    config: ConfigService,
  ) {
    this.maxFileSize =
      config.get<AppConfig['uploads']>('uploads')?.maxFileSize ?? 5 * 1024 * 1024;
  }

  async assertWorkOrderAccess(workOrderId: string, actor: AuthUser): Promise<void> {
    await this.assertAccess(workOrderId, actor);
  }

  async assertAccess(workOrderId: string, actor: AuthUser): Promise<void> {
    const workOrder = await this.prisma.workOrder.findUnique({
      where: { id: workOrderId },
      include: { assignments: { select: { employee: { select: { userId: true } } } } },
    });
    if (!workOrder) throw new NotFoundException('Work order not found');
    if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN) return;
    if (actor.role === Role.MANAGER) {
      if (workOrder.managerId && actor.managerId && workOrder.managerId !== actor.managerId) {
        throw new ForbiddenException('This work order is managed by someone else');
      }
      return;
    }
    if (actor.role === Role.EMPLOYEE) {
      const assigned = workOrder.assignments.some((a) => a.employee.userId === actor.id);
      if (!assigned) throw new ForbiddenException('You are not assigned to this work order');
      return;
    }
    throw new ForbiddenException('You are not allowed to access these photos');
  }

  async upload(
    file: Express.Multer.File | undefined,
    dto: UploadWorkPhotoDto,
    actor: AuthUser,
  ): Promise<unknown> {
    if (!file) throw new BadRequestException('photo file is required (field "photo")');
    validateImageFile(file, this.maxFileSize);
    await this.assertAccess(dto.workOrderId, actor);
    if (dto.serviceReportId) {
      const report = await this.prisma.serviceReport.findUnique({
        where: { id: dto.serviceReportId },
      });
      if (!report) throw new BadRequestException('Service report does not exist');
      if (report.workOrderId !== dto.workOrderId) {
        throw new BadRequestException('Service report belongs to a different work order');
      }
    }
    const uploaded = await this.cloudinary.uploadImage(file, 'spectra/work-photos');
    const photo = await this.prisma.workPhoto.create({
      data: {
        workOrderId: dto.workOrderId,
        serviceReportId: dto.serviceReportId,
        uploadedById: actor.id,
        imageUrl: uploaded.imageUrl,
        thumbnailUrl: uploaded.thumbnailUrl,
        caption: dto.caption,
      },
      include: photoInclude,
    });
    await this.audit.log({
      action: 'UPLOAD_WORK_PHOTO',
      module: 'work-photos',
      entity: 'WorkPhoto',
      entityId: photo.id,
      userId: actor.id,
      newValues: { workOrderId: dto.workOrderId },
    });
    return photo;
  }

  async list(query: ListWorkPhotosDto, actor: AuthUser): Promise<PaginatedResult<unknown>> {
    const { skip, take, page, limit, sortBy, sortOrder } = normalizePagination(query);
    const and: Prisma.WorkPhotoWhereInput[] = [];
    if (query.workOrderId) and.push({ workOrderId: query.workOrderId });
    if (query.serviceReportId) and.push({ serviceReportId: query.serviceReportId });
    if (actor.role === Role.CUSTOMER) {
      and.push({ workOrder: { customerId: actor.customerId ?? '__none__' } });
      and.push({ serviceReport: { status: 'APPROVED' } });
    }
    if (actor.role === Role.EMPLOYEE) {
      and.push({ workOrder: { assignments: { some: { employee: { userId: actor.id } } } } });
    }
    const where: Prisma.WorkPhotoWhereInput = and.length ? { AND: and } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.workPhoto.findMany({
        where, skip, take,
        orderBy: safeOrderBy(sortBy, sortOrder, ['createdAt']),
        include: photoInclude,
      }),
      this.prisma.workPhoto.count({ where }),
    ]);
    return paginated(items, page, limit, total);
  }

  async remove(id: string, actor: AuthUser): Promise<{ removed: boolean }> {
    const photo = await this.prisma.workPhoto.findUnique({ where: { id } });
    if (!photo) throw new NotFoundException('Photo not found');
    await this.assertAccess(photo.workOrderId, actor);
    if (actor.role === Role.EMPLOYEE && photo.uploadedById !== actor.id) {
      throw new ForbiddenException('You can only delete photos you uploaded');
    }
    await this.prisma.workPhoto.delete({ where: { id } });
    await this.audit.log({
      action: 'DELETE_WORK_PHOTO',
      module: 'work-photos',
      entity: 'WorkPhoto',
      entityId: id,
      userId: actor.id,
      oldValues: { workOrderId: photo.workOrderId },
    });
    return { removed: true };
  }
}
