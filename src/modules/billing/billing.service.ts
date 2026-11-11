import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceAdjustmentStatus, InvoiceAdjustmentType, InvoiceItemCategory, Prisma, Role, ServiceInvoiceStatus, WorkOrderStatus } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.module';
import { AuthUser } from '../../common/types/auth.types';
import { SettingsService } from '../../common/settings/settings.module';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../database/prisma.service';
import { CreateInvoiceAdjustmentDto, CreateInvoiceDto, InvoiceItemInputDto, UpdateBillingConfigDto, UpdateInvoiceDto } from './dto/billing.dto';

const includeInvoice = {
  items: { orderBy: { createdAt: 'asc' as const }, include: { attachments: true } },
  attachments: true,
  booking: { select: { id: true, bookingNumber: true } },
  workOrder: { select: { id: true, workOrderNumber: true, managerId: true } },
  service: { select: { id: true, name: true, basePrice: true, gstRate: true, gstInclusive: true } },
  customer: { select: { id: true, user: { select: { id: true, firstName: true, lastName: true, email: true } } } },
  createdBy: { select: { id: true, firstName: true, lastName: true } },
  approvedBy: { select: { id: true, firstName: true, lastName: true } },
  finalizedBy: { select: { id: true, firstName: true, lastName: true } },
  adjustments: { where: { status: InvoiceAdjustmentStatus.FINALIZED }, orderBy: { finalizedAt: 'asc' as const } },
} satisfies Prisma.ServiceInvoiceInclude;

type WorkBillingContext = Prisma.WorkOrderGetPayload<{ include: { booking: true; customer: { include: { addresses: true } }; service: true; assignments: true; company: true } }>;

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async getConfig(actor: AuthUser) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Billing configuration access denied');
    const companyId = actor.companyId;
    if (!companyId) throw new BadRequestException('Company context is required');
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { gstStateCode: true } });
    return {
      managerCanAddCharges: await this.settings.getBoolean('BILLING_MANAGER_CHARGE_ENTRY_ENABLED', false, companyId),
      allowSelfApproval: await this.settings.getBoolean('BILLING_ALLOW_SELF_APPROVAL', false, companyId),
      gstStateCode: company?.gstStateCode ?? null,
      gstRateSource: 'Service configuration (gstRate/gstInclusive)',
    };
  }

  async updateConfig(dto: UpdateBillingConfigDto, actor: AuthUser) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Only admins can update billing configuration');
    if (!actor.companyId) throw new BadRequestException('Company context is required');
    if (dto.managerCanAddCharges !== undefined) await this.settings.set('BILLING_MANAGER_CHARGE_ENTRY_ENABLED', String(dto.managerCanAddCharges), 'Allow managers to edit billing drafts', actor.companyId);
    if (dto.allowSelfApproval !== undefined) await this.settings.set('BILLING_ALLOW_SELF_APPROVAL', String(dto.allowSelfApproval), 'Allow invoice creators to approve their own billing', actor.companyId);
    if (dto.gstStateCode !== undefined) await this.prisma.company.update({ where: { id: actor.companyId }, data: { gstStateCode: dto.gstStateCode } });
    await this.audit.log({ action: 'BILLING_CONFIG_UPDATED', module: 'billing', entity: 'Company', entityId: actor.companyId, userId: actor.id, newValues: dto as Prisma.InputJsonValue });
    return this.getConfig(actor);
  }

  private async workContext(workOrderId: string, actor: AuthUser): Promise<WorkBillingContext> {
    const work = await this.prisma.workOrder.findFirst({
      where: { id: workOrderId, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }) },
      include: { booking: true, customer: { include: { addresses: true } }, service: true, assignments: true, company: true },
    });
    if (!work) throw new NotFoundException('Work order not found');
    if ((work.status !== WorkOrderStatus.COMPLETED && work.status !== WorkOrderStatus.APPROVED) || !work.completedAt) {
      throw new BadRequestException('Billing can only be created after service completion');
    }
    if (actor.role === Role.EMPLOYEE && !await this.isSupervisor(actor) && !work.assignments.some((a) => a.employeeId === actor.employeeId && !['CANCELLED', 'TRANSFERRED'].includes(a.status))) {
      throw new ForbiddenException('You are not assigned to this work order');
    }
    if (actor.role === Role.MANAGER && work.managerId !== actor.managerId) throw new ForbiddenException('Work order is outside your authorized team');
    return work;
  }

  private async canAddCharges(actor: AuthUser, companyId: string): Promise<void> {
    if (actor.role === Role.SUPER_ADMIN || actor.role === Role.ADMIN || actor.role === Role.EMPLOYEE) return;
    if (actor.role === Role.MANAGER && await this.settings.getBoolean('BILLING_MANAGER_CHARGE_ENTRY_ENABLED', false, companyId)) return;
    throw new ForbiddenException('You cannot add billing charges');
  }

  private async isSupervisor(actor: AuthUser): Promise<boolean> {
    if (actor.role === Role.MANAGER) return true;
    if (actor.role !== Role.EMPLOYEE || !actor.employeeId) return false;
    const employee = await this.prisma.employee.findUnique({ where: { id: actor.employeeId }, select: { designationRecord: { select: { name: true } }, designation: true } });
    return (employee?.designationRecord?.name ?? employee?.designation ?? '').trim().toLocaleLowerCase() === 'supervisor';
  }

  private money(value: number): Prisma.Decimal {
    if (!Number.isFinite(value) || value < 0 || value > 9_999_999_999.99) throw new BadRequestException('Billing amounts must be between 0 and 9,999,999,999.99');
    return new Prisma.Decimal(value.toFixed(2));
  }

  private async calculatedData(work: WorkBillingContext, items: InvoiceItemInputDto[], discount: number) {
    const base = new Prisma.Decimal(work.booking.baseServicePrice.toString()).toDecimalPlaces(2);
    const itemAmounts = items.map((item) => this.money(item.quantity * item.unitPrice));
    const charges = itemAmounts.reduce((sum, amount, index) => sum.plus(items[index].category === InvoiceItemCategory.DISCOUNT ? 0 : amount), new Prisma.Decimal(0));
    const lineDiscounts = itemAmounts.reduce((sum, amount, index) => sum.plus(items[index].category === InvoiceItemCategory.DISCOUNT ? amount : new Prisma.Decimal(0)), new Prisma.Decimal(0));
    const gross = base.plus(charges).toDecimalPlaces(2);
    const discountAmount = this.money(discount).plus(lineDiscounts).toDecimalPlaces(2);
    if (discountAmount.greaterThan(gross)) throw new BadRequestException('Discount cannot exceed the pre-tax amount');
    const subtotal = gross.minus(discountAmount).toDecimalPlaces(2);
    const gstRate = new Prisma.Decimal(work.service.gstRate.toString());
    if (gstRate.lessThan(0) || gstRate.greaterThan(100)) throw new BadRequestException('Service GST rate must be between 0 and 100');

    let taxableAmount = subtotal;
    let gstAmount = new Prisma.Decimal(0);
    if (gstRate.greaterThan(0)) {
      if (!work.company.gstStateCode || !work.customer.addresses.find((a) => a.id === work.serviceLocationId)?.gstStateCode) {
        throw new BadRequestException('Configure company and service-location GST state codes before applying GST');
      }
      if (work.service.gstInclusive) {
        taxableAmount = subtotal.dividedBy(new Prisma.Decimal(1).plus(gstRate.dividedBy(100))).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
        gstAmount = subtotal.minus(taxableAmount).toDecimalPlaces(2);
      } else {
        gstAmount = subtotal.mul(gstRate).dividedBy(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
      }
    }
    const interstate = work.company.gstStateCode !== work.customer.addresses.find((a) => a.id === work.serviceLocationId)?.gstStateCode;
    const cgstAmount = interstate ? new Prisma.Decimal(0) : gstAmount.dividedBy(2).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const sgstAmount = interstate ? new Prisma.Decimal(0) : gstAmount.minus(cgstAmount).toDecimalPlaces(2);
    const igstAmount = interstate ? gstAmount : new Prisma.Decimal(0);
    const finalAmount = work.service.gstInclusive ? subtotal : subtotal.plus(gstAmount).toDecimalPlaces(2);
    if (gross.greaterThan('9999999999.99') || taxableAmount.greaterThan('9999999999.99') || gstAmount.greaterThan('9999999999.99') || finalAmount.greaterThan('9999999999.99')) {
      throw new BadRequestException('Calculated invoice total exceeds the supported amount range');
    }
    return { baseServicePrice: base, discountAmount, subtotal, taxableAmount, gstRate, gstAmount, cgstAmount, sgstAmount, igstAmount, finalAmount, taxInclusive: work.service.gstInclusive };
  }

  private itemData(items: InvoiceItemInputDto[], actorId: string) {
    return items.map((item) => ({
      category: item.category,
      description: item.description.trim(),
      quantity: new Prisma.Decimal(item.quantity.toFixed(3)),
      unitPrice: this.money(item.unitPrice),
      amount: this.money(item.quantity * item.unitPrice).times(item.category === InvoiceItemCategory.DISCOUNT ? -1 : 1),
      createdById: actorId,
    }));
  }

  async create(dto: CreateInvoiceDto, actor: AuthUser) {
    const work = await this.workContext(dto.workOrderId, actor);
    await this.canAddCharges(actor, work.companyId);
    const existing = await this.prisma.serviceInvoice.findUnique({ where: { workOrderId: work.id } });
    if (existing) throw new BadRequestException('Billing already exists for this work order');
    const items = dto.items ?? [];
    const totals = await this.calculatedData(work, items, dto.discountAmount ?? 0);
    const invoice = await this.prisma.$transaction(async (tx) => {
      const created = await tx.serviceInvoice.create({
        data: {
          companyId: work.companyId, bookingId: work.bookingId, workOrderId: work.id,
          customerId: work.customerId, serviceId: work.serviceId, ...totals,
          status: ServiceInvoiceStatus.DRAFT, createdById: actor.id,
          items: { create: this.itemData(items, actor.id) },
          history: { create: { action: 'CREATED', newStatus: ServiceInvoiceStatus.DRAFT, performedById: actor.id } },
        }, include: includeInvoice,
      });
      return created;
    });
    await this.audit.log({ action: 'BILLING_DRAFT_CREATED', module: 'billing', entity: 'ServiceInvoice', entityId: invoice.id, userId: actor.id });
    return invoice;
  }

  async update(id: string, dto: UpdateInvoiceDto, actor: AuthUser) {
    const invoice = await this.accessInvoice(id, actor);
    await this.canAddCharges(actor, invoice.companyId);
    if (invoice.status !== ServiceInvoiceStatus.DRAFT && invoice.status !== ServiceInvoiceStatus.REJECTED) throw new BadRequestException('Only draft or rejected billing can be edited');
    const work = await this.workContext(invoice.workOrderId, actor);
    const items = dto.items ?? invoice.items.map((i) => ({ category: i.category, description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice) }));
    const totals = await this.calculatedData(work, items, dto.discountAmount ?? Number(invoice.discountAmount));
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.serviceInvoice.updateMany({ where: { id, status: invoice.status, updatedAt: invoice.updatedAt }, data: totals });
      if (!changed.count) throw new BadRequestException('Billing changed while you were editing; reload and try again');
      if (dto.items) {
        await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
        await tx.invoiceItem.createMany({ data: this.itemData(items, actor.id).map((item) => ({ ...item, invoiceId: id })) });
      }
      await tx.invoiceApprovalHistory.create({ data: { invoiceId: id, action: 'DRAFT_UPDATED', previousStatus: invoice.status, newStatus: invoice.status, performedById: actor.id, changes: { discountBefore: invoice.discountAmount.toString(), discountAfter: totals.discountAmount.toString(), itemsBefore: invoice.items.map((i) => ({ category: i.category, description: i.description, quantity: i.quantity.toString(), unitPrice: i.unitPrice.toString(), amount: i.amount.toString() })), itemsAfter: dto.items ? items.map((i) => ({ ...i })) : undefined } } });
      return tx.serviceInvoice.findUniqueOrThrow({ where: { id }, include: includeInvoice });
    });
  }

  async get(id: string, actor: AuthUser) {
    const invoice = await this.accessInvoice(id, actor);
    if (actor.role === Role.CUSTOMER && invoice.status !== ServiceInvoiceStatus.FINALIZED) throw new NotFoundException('Invoice not found');
    return this.withAdjustedTotal(invoice);
  }

  async list(actor: AuthUser, status?: ServiceInvoiceStatus, workOrderId?: string) {
    const where: Prisma.ServiceInvoiceWhereInput = {
      ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }),
      ...(actor.role === Role.EMPLOYEE && !await this.isSupervisor(actor) ? { createdById: actor.id } : {}),
      ...(actor.role === Role.CUSTOMER ? { customer: { userId: actor.id }, status: ServiceInvoiceStatus.FINALIZED } : {}),
      ...(actor.role === Role.MANAGER ? { workOrder: { managerId: actor.managerId ?? '__none__' } } : {}),
      ...(status ? { status } : {}), ...(workOrderId ? { workOrderId } : {}),
    };
    const invoices = await this.prisma.serviceInvoice.findMany({ where, include: includeInvoice, orderBy: { createdAt: 'desc' }, take: 100 });
    return invoices.map((invoice) => this.withAdjustedTotal(invoice));
  }

  async pending(actor: AuthUser) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.SUPER_ADMIN && !await this.isSupervisor(actor)) throw new ForbiddenException('Approval permission required');
    return this.list(actor, ServiceInvoiceStatus.PENDING_APPROVAL);
  }

  async submit(id: string, actor: AuthUser) {
    const invoice = await this.accessInvoice(id, actor);
    await this.canAddCharges(actor, invoice.companyId);
    if (invoice.status !== ServiceInvoiceStatus.DRAFT && invoice.status !== ServiceInvoiceStatus.REJECTED) throw new BadRequestException('Only draft or rejected billing can be submitted');
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.serviceInvoice.updateMany({ where: { id, status: invoice.status }, data: { status: ServiceInvoiceStatus.PENDING_APPROVAL, submittedAt: new Date(), rejectionReason: null } });
      if (!changed.count) throw new BadRequestException('Billing status changed; reload and try again');
      await tx.invoiceApprovalHistory.create({ data: { invoiceId: id, action: invoice.status === ServiceInvoiceStatus.REJECTED ? 'RESUBMITTED' : 'SUBMITTED', previousStatus: invoice.status, newStatus: ServiceInvoiceStatus.PENDING_APPROVAL, performedById: actor.id } });
      return tx.serviceInvoice.findUniqueOrThrow({ where: { id }, include: includeInvoice });
    });
    await this.notifyApprovers(invoice.companyId, invoice.workOrderId, invoice.id, 'Billing pending approval', 'A completed service bill is waiting for approval.');
    await this.audit.log({ action: 'BILLING_SUBMITTED', module: 'billing', entity: 'ServiceInvoice', entityId: id, userId: actor.id });
    return updated;
  }

  async decide(id: string, approve: boolean, remarks: string | undefined, actor: AuthUser) {
    const supervisor = await this.isSupervisor(actor);
    if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.SUPER_ADMIN && !supervisor) throw new ForbiddenException('Approval permission required');
    const invoice = await this.accessInvoice(id, actor);
    if (invoice.status !== ServiceInvoiceStatus.PENDING_APPROVAL) throw new BadRequestException('Only submitted billing can be approved or rejected');
    if (actor.role === Role.MANAGER && invoice.workOrder.managerId !== actor.managerId) throw new ForbiddenException('Invoice is outside your authorized team');
    const allowSelf = await this.settings.getBoolean('BILLING_ALLOW_SELF_APPROVAL', false, invoice.companyId);
    if (!allowSelf && invoice.createdById === actor.id) throw new ForbiddenException('You cannot approve billing that you created');
    const status = approve ? ServiceInvoiceStatus.APPROVED : ServiceInvoiceStatus.REJECTED;
    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.serviceInvoice.updateMany({ where: { id, status: ServiceInvoiceStatus.PENDING_APPROVAL }, data: { status, approvedById: approve ? actor.id : null, approvedAt: approve ? new Date() : null, rejectionReason: approve ? null : remarks } });
      if (!changed.count) throw new BadRequestException('Billing status changed; reload and try again');
      await tx.invoiceApprovalHistory.create({ data: { invoiceId: id, action: approve ? 'APPROVED' : 'REJECTED', previousStatus: ServiceInvoiceStatus.PENDING_APPROVAL, newStatus: status, remarks, performedById: actor.id } });
      return tx.serviceInvoice.findUniqueOrThrow({ where: { id }, include: includeInvoice });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.notifyUser(invoice.createdById, `Billing ${approve ? 'approved' : 'rejected'}`, remarks ?? `Your billing was ${approve ? 'approved' : 'rejected'}.`, id);
    await this.audit.log({ action: approve ? 'BILLING_APPROVED' : 'BILLING_REJECTED', module: 'billing', entity: 'ServiceInvoice', entityId: id, userId: actor.id, newValues: { remarks } });
    return result;
  }

  async finalize(id: string, actor: AuthUser) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Only admins can finalize invoices');
    const invoice = await this.accessInvoice(id, actor);
    if (invoice.status !== ServiceInvoiceStatus.APPROVED) throw new BadRequestException('Only approved billing can be finalized');
    const finalized = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.serviceInvoice.updateMany({ where: { id, status: ServiceInvoiceStatus.APPROVED }, data: { status: ServiceInvoiceStatus.FINALIZED, finalizedById: actor.id, finalizedAt: new Date() } });
      if (!changed.count) throw new BadRequestException('Billing status changed; reload and try again');
      await tx.invoiceApprovalHistory.create({ data: { invoiceId: id, action: 'FINALIZED', previousStatus: ServiceInvoiceStatus.APPROVED, newStatus: ServiceInvoiceStatus.FINALIZED, performedById: actor.id } });
      return tx.serviceInvoice.findUniqueOrThrow({ where: { id }, include: includeInvoice });
    });
    if (finalized.customer.user) {
      await this.notifyUser(finalized.customer.user.id, 'Final invoice available', 'Your invoice is ready to view.', id);
    }
    await this.audit.log({ action: 'BILLING_FINALIZED', module: 'billing', entity: 'ServiceInvoice', entityId: id, userId: actor.id });
    return finalized;
  }

  async attach(id: string, fileUrl: string, fileType: string, invoiceItemId: string | undefined, actor: AuthUser) {
    const invoice = await this.accessInvoice(id, actor);
    await this.canAddCharges(actor, invoice.companyId);
    if (invoice.status !== ServiceInvoiceStatus.DRAFT && invoice.status !== ServiceInvoiceStatus.REJECTED) throw new BadRequestException('Attachments can only be added to a draft or rejected invoice');
    if (invoiceItemId && !invoice.items.some((item) => item.id === invoiceItemId)) throw new BadRequestException('Invoice item does not belong to this invoice');
    const attachment = await this.prisma.invoiceAttachment.create({ data: { invoiceId: id, invoiceItemId, fileUrl, fileType, uploadedById: actor.id } });
    await this.prisma.invoiceApprovalHistory.create({ data: { invoiceId: id, action: 'ATTACHMENT_ADDED', previousStatus: invoice.status, newStatus: invoice.status, performedById: actor.id, changes: { attachmentId: attachment.id } } });
    return attachment;
  }

  async assertCanAttach(id: string, actor: AuthUser): Promise<void> {
    const invoice = await this.accessInvoice(id, actor);
    await this.canAddCharges(actor, invoice.companyId);
    if (invoice.status !== ServiceInvoiceStatus.DRAFT && invoice.status !== ServiceInvoiceStatus.REJECTED) throw new BadRequestException('Attachments can only be added to a draft or rejected invoice');
  }

  async history(id: string, actor: AuthUser) {
    const invoice = await this.accessInvoice(id, actor);
    if (actor.role === Role.CUSTOMER && invoice.status !== ServiceInvoiceStatus.FINALIZED) throw new NotFoundException('Invoice not found');
    return this.prisma.invoiceApprovalHistory.findMany({ where: { invoiceId: id }, include: { performedBy: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { performedAt: 'asc' } });
  }

  async createAdjustment(invoiceId: string, dto: CreateInvoiceAdjustmentDto, actor: AuthUser) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.SUPER_ADMIN && !await this.isSupervisor(actor)) throw new ForbiddenException('Adjustment permission required');
    const invoice = await this.accessInvoice(invoiceId, actor);
    if (invoice.status !== ServiceInvoiceStatus.FINALIZED) throw new BadRequestException('Adjustments are only available for finalized invoices');
    const adjustment = await this.prisma.invoiceAdjustment.create({ data: { invoiceId, type: dto.type, amount: this.money(dto.amount), reason: dto.reason.trim(), createdById: actor.id } });
    await this.prisma.invoiceApprovalHistory.create({ data: { invoiceId, action: 'ADJUSTMENT_CREATED', previousStatus: ServiceInvoiceStatus.FINALIZED, newStatus: ServiceInvoiceStatus.FINALIZED, performedById: actor.id, changes: { adjustmentId: adjustment.id, type: adjustment.type, amount: adjustment.amount.toString(), reason: adjustment.reason } } });
    await this.notifyApprovers(invoice.companyId, invoice.workOrderId, invoice.id, 'Invoice adjustment pending approval', `A ${dto.type === InvoiceAdjustmentType.CREDIT_NOTE ? 'credit' : 'debit'} note requires approval.`);
    return adjustment;
  }

  async decideAdjustment(adjustmentId: string, approve: boolean, remarks: string | undefined, actor: AuthUser) {
    const supervisor = await this.isSupervisor(actor);
    if (actor.role !== Role.ADMIN && actor.role !== Role.MANAGER && actor.role !== Role.SUPER_ADMIN && !supervisor) throw new ForbiddenException('Adjustment approval permission required');
    const adjustment = await this.prisma.invoiceAdjustment.findFirst({
      where: { id: adjustmentId, ...(actor.role === Role.SUPER_ADMIN ? {} : { invoice: { companyId: actor.companyId ?? '__none__' } }) },
      include: { invoice: { include: { workOrder: { select: { id: true, managerId: true } } } } },
    });
    if (!adjustment) throw new NotFoundException('Invoice adjustment not found');
    if (actor.role === Role.MANAGER && adjustment.invoice.workOrder.managerId !== actor.managerId) throw new ForbiddenException('Adjustment is outside your authorized team');
    if (adjustment.status !== InvoiceAdjustmentStatus.PENDING_APPROVAL) throw new BadRequestException('Only pending adjustments can be approved or rejected');
    if (!await this.settings.getBoolean('BILLING_ALLOW_SELF_APPROVAL', false, adjustment.invoice.companyId) && adjustment.createdById === actor.id) throw new ForbiddenException('You cannot approve an adjustment you created');
    const status = approve ? InvoiceAdjustmentStatus.APPROVED : InvoiceAdjustmentStatus.REJECTED;
    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.invoiceAdjustment.updateMany({ where: { id: adjustmentId, status: InvoiceAdjustmentStatus.PENDING_APPROVAL }, data: { status, approvedById: approve ? actor.id : null, approvedAt: approve ? new Date() : null } });
      if (!changed.count) throw new BadRequestException('Adjustment status changed; reload and try again');
      await tx.invoiceApprovalHistory.create({ data: { invoiceId: adjustment.invoiceId, action: approve ? 'ADJUSTMENT_APPROVED' : 'ADJUSTMENT_REJECTED', previousStatus: ServiceInvoiceStatus.FINALIZED, newStatus: ServiceInvoiceStatus.FINALIZED, remarks, performedById: actor.id, changes: { adjustmentId, adjustmentStatus: status } } });
      return tx.invoiceAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
    });
    await this.notifyUser(adjustment.createdById, `Invoice adjustment ${approve ? 'approved' : 'rejected'}`, remarks ?? `Your invoice adjustment was ${approve ? 'approved' : 'rejected'}.`, adjustment.invoiceId);
    return result;
  }

  async finalizeAdjustment(adjustmentId: string, actor: AuthUser) {
    if (actor.role !== Role.ADMIN && actor.role !== Role.SUPER_ADMIN) throw new ForbiddenException('Only admins can finalize invoice adjustments');
    const adjustment = await this.prisma.invoiceAdjustment.findFirst({
      where: { id: adjustmentId, ...(actor.role === Role.SUPER_ADMIN ? {} : { invoice: { companyId: actor.companyId ?? '__none__' } }) },
      include: { invoice: true },
    });
    if (!adjustment) throw new NotFoundException('Invoice adjustment not found');
    if (adjustment.status !== InvoiceAdjustmentStatus.APPROVED) throw new BadRequestException('Only approved adjustments can be finalized');
    const finalized = await this.prisma.$transaction(async (tx) => {
      const currentAdjustments = await tx.invoiceAdjustment.findMany({ where: { invoiceId: adjustment.invoiceId, status: InvoiceAdjustmentStatus.FINALIZED } });
      let adjustedTotal = new Prisma.Decimal(adjustment.invoice.finalAmount.toString());
      for (const current of currentAdjustments) {
        const amount = new Prisma.Decimal(current.amount.toString());
        adjustedTotal = adjustedTotal.plus(current.type === InvoiceAdjustmentType.CREDIT_NOTE ? amount.negated() : amount);
      }
      adjustedTotal = adjustedTotal.plus(adjustment.type === InvoiceAdjustmentType.CREDIT_NOTE ? adjustment.amount.negated() : adjustment.amount);
      if (adjustedTotal.lessThan(0)) throw new BadRequestException('Credit notes cannot reduce the payable below zero');
      const changed = await tx.invoiceAdjustment.updateMany({ where: { id: adjustmentId, status: InvoiceAdjustmentStatus.APPROVED }, data: { status: InvoiceAdjustmentStatus.FINALIZED, finalizedAt: new Date() } });
      if (!changed.count) throw new BadRequestException('Adjustment status changed; reload and try again');
      await tx.invoiceApprovalHistory.create({ data: { invoiceId: adjustment.invoiceId, action: 'ADJUSTMENT_FINALIZED', previousStatus: ServiceInvoiceStatus.FINALIZED, newStatus: ServiceInvoiceStatus.FINALIZED, performedById: actor.id, changes: { adjustmentId, adjustedFinalAmount: adjustedTotal.toFixed(2) } } });
      const result = await tx.invoiceAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } });
      return { result, adjustedTotal };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    const customer = await this.prisma.customer.findUnique({ where: { id: adjustment.invoice.customerId }, select: { userId: true } });
    if (customer?.userId) await this.notifyUser(customer.userId, 'Invoice adjustment finalized', `Your adjusted payable amount is INR ${finalized.adjustedTotal.toFixed(2)}.`, adjustment.invoiceId);
    return finalized.result;
  }

  private withAdjustedTotal<T extends { finalAmount: Prisma.Decimal; adjustments: Array<{ type: InvoiceAdjustmentType; amount: Prisma.Decimal }> }>(invoice: T) {
    const total = invoice.adjustments.reduce((sum, adjustment) => sum.plus(adjustment.type === InvoiceAdjustmentType.CREDIT_NOTE ? adjustment.amount.negated() : adjustment.amount), new Prisma.Decimal(invoice.finalAmount.toString()));
    return { ...invoice, adjustedFinalAmount: total.toFixed(2) };
  }

  async accessInvoice(id: string, actor: AuthUser) {
    const invoice = await this.prisma.serviceInvoice.findFirst({
      where: { id, ...(actor.role === Role.SUPER_ADMIN ? {} : { companyId: actor.companyId ?? '__none__' }), ...(actor.role === Role.CUSTOMER ? { customer: { userId: actor.id } } : {}) },
      include: { ...includeInvoice, workOrder: { select: { id: true, workOrderNumber: true, managerId: true } } },
    });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (actor.role === Role.EMPLOYEE && !await this.isSupervisor(actor) && invoice.createdById !== actor.id) throw new ForbiddenException('Invoice is outside your authorized billing');
    if (actor.role === Role.MANAGER && invoice.workOrder.managerId !== actor.managerId) throw new ForbiddenException('Invoice is outside your authorized team');
    return invoice;
  }

  async notifyApprovers(companyId: string, workOrderId: string, invoiceId: string, title: string, message: string) {
    const work = await this.prisma.workOrder.findUnique({ where: { id: workOrderId }, select: { manager: { select: { userId: true } } } });
    const admins = await this.prisma.user.findMany({ where: { companyId, role: Role.ADMIN, isActive: true }, select: { id: true } });
    const supervisors = await this.prisma.user.findMany({ where: { companyId, role: Role.EMPLOYEE, isActive: true, employee: { designationRecord: { is: { name: { equals: 'Supervisor', mode: 'insensitive' } } } } }, select: { id: true } });
    const recipients = new Set([...admins.map((u) => u.id), ...supervisors.map((u) => u.id), ...(work?.manager?.userId ? [work.manager.userId] : [])]);
    await Promise.all([...recipients].map((userId) => this.notifyUser(userId, title, message, invoiceId)));
  }

  private async notifyUser(userId: string, title: string, message: string, invoiceId: string) {
    try { await this.notifications.notify({ userId, title, message, referenceType: 'service_invoice', referenceId: invoiceId }); } catch { /* Billing remains committed if push delivery queue is temporarily unavailable. */ }
  }
}
