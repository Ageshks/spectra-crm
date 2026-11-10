import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { CloudinaryService, validateImageFile } from '../../common/uploads/uploads.module';
import { BillingService } from './billing.service';
import { CreateInvoiceAdjustmentDto, CreateInvoiceDto, InvoiceAttachmentDto, InvoiceDecisionDto, ListInvoicesDto, RejectInvoiceDto, UpdateBillingConfigDto, UpdateInvoiceDto } from './dto/billing.dto';

@ApiTags('billing')
@ApiBearerAuth()
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService, private readonly cloudinary: CloudinaryService) {}

  @Get('config')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN)
  @ResponseMessage('Billing configuration retrieved')
  config(@CurrentUser() actor: AuthUser) { return this.billing.getConfig(actor); }

  @Put('config')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ResponseMessage('Billing configuration updated')
  updateConfig(@Body() dto: UpdateBillingConfigDto, @CurrentUser() actor: AuthUser) { return this.billing.updateConfig(dto, actor); }

  @Get('pending-approvals')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.EMPLOYEE)
  @ApiOperation({ summary: 'List billing waiting for approval in the authorized company/team' })
  @ResponseMessage('Pending billing retrieved')
  pending(@CurrentUser() actor: AuthUser) { return this.billing.pending(actor); }

  @Get()
  @ApiOperation({ summary: 'List role-scoped service invoices' })
  @ResponseMessage('Billing retrieved')
  list(@CurrentUser() actor: AuthUser, @Query() query: ListInvoicesDto) { return this.billing.list(actor, query.status, query.workOrderId); }

  @Post()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Create a post-service billing draft' })
  @ResponseMessage('Billing draft created')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() actor: AuthUser) { return this.billing.create(dto, actor); }

  @Get(':id')
  @ApiOperation({ summary: 'Get billing details; customers can only see finalized invoices' })
  @ResponseMessage('Billing retrieved')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return this.billing.get(id, actor); }

  @Put(':id')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Replace draft charge items or update discount' })
  @ResponseMessage('Billing draft updated')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateInvoiceDto, @CurrentUser() actor: AuthUser) { return this.billing.update(id, dto, actor); }

  @Post(':id/attachments')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @UseInterceptors(FileInterceptor('receipt', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { receipt: { type: 'string', format: 'binary' }, invoiceItemId: { type: 'string', format: 'uuid' } }, required: ['receipt'] } })
  @ApiOperation({ summary: 'Upload a receipt image for an invoice or charge item' })
  @ResponseMessage('Receipt uploaded')
  async attach(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File, @Body() dto: InvoiceAttachmentDto, @CurrentUser() actor: AuthUser) {
    if (!file) throw new BadRequestException('receipt file is required');
    validateImageFile(file, 5 * 1024 * 1024);
    await this.billing.assertCanAttach(id, actor);
    const uploaded = await this.cloudinary.uploadImage(file, 'spectra/invoice-receipts');
    return this.billing.attach(id, uploaded.imageUrl, file.mimetype, dto.invoiceItemId, actor);
  }

  @Post(':id/submit')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Submit or resubmit billing for approval' })
  @ResponseMessage('Billing submitted for approval')
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return this.billing.submit(id, actor); }

  @Post(':id/approve')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.EMPLOYEE)
  @ApiOperation({ summary: 'Approve submitted billing' })
  @ResponseMessage('Billing approved')
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: InvoiceDecisionDto, @CurrentUser() actor: AuthUser) { return this.billing.decide(id, true, dto.remarks, actor); }

  @Post(':id/reject')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.EMPLOYEE)
  @ApiOperation({ summary: 'Reject submitted billing with a reason' })
  @ResponseMessage('Billing rejected')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectInvoiceDto, @CurrentUser() actor: AuthUser) { return this.billing.decide(id, false, dto.remarks, actor); }

  @Post(':id/finalize')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Finalize approved billing and expose it to the customer' })
  @ResponseMessage('Invoice finalized')
  finalize(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return this.billing.finalize(id, actor); }

  @Post(':id/adjustments')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.EMPLOYEE)
  @ResponseMessage('Invoice adjustment submitted')
  createAdjustment(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInvoiceAdjustmentDto, @CurrentUser() actor: AuthUser) { return this.billing.createAdjustment(id, dto, actor); }

  @Post('adjustments/:adjustmentId/approve')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.EMPLOYEE)
  @ResponseMessage('Invoice adjustment approved')
  approveAdjustment(@Param('adjustmentId', ParseUUIDPipe) id: string, @Body() dto: InvoiceDecisionDto, @CurrentUser() actor: AuthUser) { return this.billing.decideAdjustment(id, true, dto.remarks, actor); }

  @Post('adjustments/:adjustmentId/reject')
  @Roles(Role.ADMIN, Role.MANAGER, Role.SUPER_ADMIN, Role.EMPLOYEE)
  @ResponseMessage('Invoice adjustment rejected')
  rejectAdjustment(@Param('adjustmentId', ParseUUIDPipe) id: string, @Body() dto: RejectInvoiceDto, @CurrentUser() actor: AuthUser) { return this.billing.decideAdjustment(id, false, dto.remarks, actor); }

  @Post('adjustments/:adjustmentId/finalize')
  @Roles(Role.ADMIN, Role.SUPER_ADMIN)
  @ResponseMessage('Invoice adjustment finalized')
  finalizeAdjustment(@Param('adjustmentId', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return this.billing.finalizeAdjustment(id, actor); }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get the billing approval and edit history' })
  @ResponseMessage('Billing history retrieved')
  history(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) { return this.billing.history(id, actor); }

  @Get(':id/pdf')
  @ApiOperation({ summary: 'Download a finalized invoice PDF' })
  async pdf(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser, @Res() response: Response) {
    const invoice = await this.billing.get(id, actor) as any;
    if (invoice.status !== 'FINALIZED') throw new BadRequestException('Only finalized invoices have a customer PDF');
    const lines = [
      'SPECTRA - TAX INVOICE',
      `Invoice: ${invoice.id}`,
      `Booking: ${invoice.booking.bookingNumber}`,
      `Customer: ${invoice.customer.user.firstName} ${invoice.customer.user.lastName}`,
      `Service: ${invoice.service.name}`,
      `Base service price: INR ${invoice.baseServicePrice}`,
      ...invoice.items.map((item: any) => `${item.description}: INR ${item.amount}`),
      `Taxable amount: INR ${invoice.taxableAmount}`,
      `CGST: INR ${invoice.cgstAmount}  SGST: INR ${invoice.sgstAmount}  IGST: INR ${invoice.igstAmount}`,
      `Final amount: INR ${invoice.finalAmount}`,
      ...invoice.adjustments.map((adjustment: any) => `${adjustment.type}: INR ${adjustment.amount} (${adjustment.reason})`),
      `Adjusted payable amount: INR ${invoice.adjustedFinalAmount}`,
    ];
    response.setHeader('Content-Type', 'application/pdf');
    response.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.id}.pdf"`);
    response.send(this.buildPdf(lines));
  }

  private buildPdf(lines: string[]): Buffer {
    const escape = (value: string) => value.replace(/[^\x20-\x7E]/g, '?').replace(/[\\()]/g, '\\$&');
    const commands = ['BT', '/F1 12 Tf', '50 790 Td', '16 TL', ...lines.flatMap((line, i) => [i === 0 ? `(${escape(line)}) Tj` : 'T*', ...(i === 0 ? [] : [`(${escape(line)}) Tj`])]), 'ET'].join('\n');
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
      `<< /Length ${Buffer.byteLength(commands, 'ascii')} >>\nstream\n${commands}\nendstream`,
    ];
    let body = '%PDF-1.4\n';
    const offsets = [0];
    for (let i = 0; i < objects.length; i++) { offsets.push(Buffer.byteLength(body, 'ascii')); body += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`; }
    const xref = Buffer.byteLength(body, 'ascii');
    body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    return Buffer.from(body, 'ascii');
  }
}
