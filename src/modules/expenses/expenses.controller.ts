import { BadRequestException, Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { memoryStorage } from 'multer';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AuthUser } from '../../common/types/auth.types';
import { CloudinaryService, validateImageFile } from '../../common/uploads/uploads.module';
import { CreateExpenseDto, ExpenseDecisionDto, ListExpensesDto } from './dto/expenses.dto';
import { ExpensesService } from './expenses.service';

@ApiTags('expenses')
@ApiBearerAuth()
@Controller('expenses')
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly cloudinary: CloudinaryService,
    private readonly config: ConfigService,
  ) {}

  @Post('receipt')
  @Roles(Role.EMPLOYEE)
  @UseInterceptors(FileInterceptor('receipt', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { receipt: { type: 'string', format: 'binary' } }, required: ['receipt'] } })
  @ApiOperation({ summary: 'Upload a receipt image and return its permanent URL' })
  @ResponseMessage('Expense receipt uploaded')
  async uploadReceipt(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('receipt file is required');
    const uploads = this.config.get<AppConfig['uploads']>('uploads');
    validateImageFile(file, uploads?.maxFileSize ?? 5 * 1024 * 1024);
    const uploaded = await this.cloudinary.uploadImage(file, 'spectra/expense-receipts');
    return { receiptUrl: uploaded.imageUrl, thumbnailUrl: uploaded.thumbnailUrl };
  }

  @Post()
  @Roles(Role.EMPLOYEE)
  @ApiOperation({ summary: 'Submit an employee expense for approval' })
  @ResponseMessage('Expense submitted for approval')
  submit(@CurrentUser() user: AuthUser, @Body() dto: CreateExpenseDto) {
    return this.expenses.submit(dto, user);
  }

  @Get()
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'List expense claims (employees see their own)' })
  @ResponseMessage('Expenses retrieved')
  list(@CurrentUser() user: AuthUser, @Query() query: ListExpensesDto) {
    return this.expenses.list(query, user);
  }

  @Get(':id')
  @Roles(Role.EMPLOYEE, Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Get an expense claim' })
  @ResponseMessage('Expense retrieved')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.expenses.getById(id, user);
  }

  @Post(':id/decision')
  @Roles(Role.MANAGER, Role.ADMIN, Role.SUPER_ADMIN)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOperation({ summary: 'Approve or reject an employee expense' })
  @ResponseMessage('Expense decision recorded')
  decide(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ExpenseDecisionDto,
  ) {
    return this.expenses.decide(id, dto, user);
  }
}
