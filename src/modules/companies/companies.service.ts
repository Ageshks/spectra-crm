import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './companies.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.company.findMany({ orderBy: { name: 'asc' } });
  }

  async create(dto: CreateCompanyDto) {
    const slug = dto.slug.trim().toLowerCase();
    if (await this.prisma.company.findUnique({ where: { slug } })) {
      throw new ConflictException('Company slug is already in use');
    }
    return this.prisma.company.create({ data: { name: dto.name.trim(), slug } });
  }

  async update(id: string, dto: UpdateCompanyDto) {
    if (!await this.prisma.company.findUnique({ where: { id }, select: { id: true } })) {
      throw new NotFoundException('Company not found');
    }
    return this.prisma.company.update({ where: { id }, data: dto });
  }
}
