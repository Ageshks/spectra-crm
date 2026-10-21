import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { EXPORT_STORAGE_DIRNAME } from '../../common/constants';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

@Injectable()
export class ExportStorageService {
  private readonly logger = new Logger(ExportStorageService.name);

  constructor(private readonly config: ConfigService) {}

  private get baseDir(): string {
    const app = this.config.get<AppConfig>('app') as AppConfig | undefined;
    return app?.exports?.storageDir ?? this.config.get<string>('EXPORT_STORAGE_DIR') ?? './storage';
  }

  getExportsDir(): string {
    return path.resolve(this.baseDir, EXPORT_STORAGE_DIRNAME);
  }

  async ensureUserDir(userId: string): Promise<string> {
    const dir = path.join(this.getExportsDir(), userId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  extensionFor(format: 'CSV' | 'XLSX'): string {
    return format === 'XLSX' ? 'xlsx' : 'csv';
  }

  async write(
    jobId: string,
    userId: string,
    format: 'CSV' | 'XLSX',
    writer: (fullPath: string) => Promise<void>,
  ): Promise<string> {
    const dir = await this.ensureUserDir(userId);
    const ext = this.extensionFor(format);
    const filename = `${jobId}.${ext}`;
    const fullPath = path.join(dir, filename);
    await writer(fullPath);
    return path.relative(this.getExportsDir(), fullPath);
  }

  resolve(relativePath: string): string {
    return path.join(this.getExportsDir(), relativePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(relativePath));
      return true;
    } catch {
      return false;
    }
  }

  async remove(relativePath: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(relativePath));
    } catch (error) {
      this.logger.warn(`Failed to remove export file ${relativePath}: ${String(error)}`);
    }
  }

  async statSize(relativePath: string): Promise<number | undefined> {
    try {
      const s = await fs.stat(this.resolve(relativePath));
      return s.size;
    } catch {
      return undefined;
    }
  }
}