import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../config/configuration';
import { ALLOWED_IMAGE_EXTENSIONS, ALLOWED_IMAGE_MIME_TYPES } from '../constants';

export interface UploadedImage {
  imageUrl: string;
  thumbnailUrl?: string;
  publicId: string;
  format: string;
  bytes: number;
  width?: number;
  height?: number;
}

export const validateImageFile = (
  file: Express.Multer.File,
  maxSize: number,
): void => {
  const { BadRequestException } = require('@nestjs/common');
  const allowedMimes = ALLOWED_IMAGE_MIME_TYPES as unknown as string[];
  if (!allowedMimes.includes(file.mimetype)) {
    throw new BadRequestException(
      `Invalid image type. Allowed: ${ALLOWED_IMAGE_EXTENSIONS.join(', ').toUpperCase()}`,
    );
  }
  if (file.size > maxSize) {
    throw new BadRequestException(
      `File too large. Maximum size is ${Math.round(maxSize / 1024 / 1024)} MB`,
    );
  }
  if (!file.buffer || file.buffer.length === 0) {
    throw new BadRequestException('Empty file upload');
  }
};

/**
 * Reusable Cloudinary service (§22). Configured purely from env vars, degrades
 * gracefully when credentials are absent: local dev / tests that never
 * configure Cloudinary get a deterministic local URL instead of a crash.
 */
@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;

  constructor(config: ConfigService) {
    const cloudinary = config.get<AppConfig['cloudinary']>('cloudinary');
    if (cloudinary?.cloudName && cloudinary.apiKey && cloudinary.apiSecret) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { v2 } = require('cloudinary');
      v2.config({
        cloud_name: cloudinary.cloudName,
        api_key: cloudinary.apiKey,
        api_secret: cloudinary.apiSecret,
        secure: true,
      });
      this.configured = true;
    } else {
      this.logger.warn('Cloudinary is not configured — uploads use local fallback URLs');
    }
  }

  isConfigured(): boolean {
    return this.configured;
  }

  private localFallback(folder: string, originalName: string): UploadedImage {
    const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const publicId = `${folder}/${Date.now()}-${safe}`;
    const imageUrl = `/uploads/${publicId}`;
    return { imageUrl, thumbnailUrl: imageUrl, publicId, format: 'jpg', bytes: 0 };
  }

  async uploadImage(
    file: Express.Multer.File,
    folder = 'spectra',
  ): Promise<UploadedImage> {
    if (!this.configured) {
      return this.localFallback(folder, file.originalname || 'image.jpg');
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { v2 } = require('cloudinary');
    const publicId = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<UploadedImage>((resolve, reject) => {
      const stream = v2.uploader.upload_stream(
        {
          public_id: publicId,
          folder: undefined,
          resource_type: 'image',
          transformation: [{ quality: 'auto', fetch_format: 'auto' }],
        },
        (
          error: Error | undefined,
          result: Record<string, unknown> | undefined,
        ) => {
          if (error || !result) {
            this.logger.error(`Cloudinary upload failed: ${String(error)}`);
            reject(new Error('Image upload failed'));
            return;
          }
          const imageUrl = String(result.secure_url ?? result.url ?? '');
          resolve({
            imageUrl,
            thumbnailUrl: this.generateSecureUrl(imageUrl, 'thumbnail'),
            publicId: String(result.public_id ?? publicId),
            format: String(result.format ?? 'jpg'),
            bytes: Number(result.bytes ?? file.size),
            width: result.width as number | undefined,
            height: result.height as number | undefined,
          });
        },
      );
      stream.end(file.buffer);
    });
  }

  async deleteImage(publicId: string): Promise<void> {
    if (!this.configured) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { v2 } = require('cloudinary');
      await v2.uploader.destroy(publicId);
    } catch (error) {
      this.logger.warn(`Cloudinary delete failed for ${publicId}: ${String(error)}`);
    }
  }

  generateSecureUrl(imageUrl: string, variant: 'thumbnail' | 'medium' | 'original'): string {
    if (!imageUrl || !this.configured) return imageUrl;
    if (variant === 'original') return imageUrl;
    // Insert a Cloudinary transformation segment after /upload/.
    const marker = '/upload/';
    const idx = imageUrl.indexOf(marker);
    if (idx === -1) return imageUrl;
    const transform =
      variant === 'thumbnail' ? 'c_thumb,w_300,h_300' : 'c_limit,w_1024';
    return `${imageUrl.slice(0, idx + marker.length)}${transform}/${imageUrl.slice(idx + marker.length)}`;
  }
}

@Global()
@Module({
  providers: [CloudinaryService],
  exports: [CloudinaryService],
})
export class UploadsModule {}
