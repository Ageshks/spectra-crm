import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { CompaniesService } from './companies.service';
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto';

@ApiTags('companies')
@ApiBearerAuth()
@Controller('companies')
@Roles(Role.SUPER_ADMIN)
export class CompaniesController {
  constructor(private readonly companies: CompaniesService) {}

  @Get()
  @ApiOperation({ summary: 'List companies (super admin)' })
  @ResponseMessage('Companies retrieved')
  list() { return this.companies.list(); }

  @Post()
  @ApiOperation({ summary: 'Create a company tenant' })
  @ResponseMessage('Company created')
  create(@Body() dto: CreateCompanyDto) { return this.companies.create(dto); }

  @Patch(':id')
  @ApiOperation({ summary: 'Update or deactivate a company tenant' })
  @ResponseMessage('Company updated')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanyDto) {
    return this.companies.update(id, dto);
  }
}
