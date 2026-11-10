import { Global, Injectable, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { Transporter } from 'nodemailer';
import { AppConfig } from '../../config/configuration';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly transport?: Transporter;
  private readonly from?: string;

  constructor(config: ConfigService) {
    const mail = config.get<AppConfig['email']>('email');
    this.from = mail?.from;
    if (mail?.host && mail.from) {
      this.transport = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        ...(mail.user && mail.password ? { auth: { user: mail.user, pass: mail.password } } : {}),
      });
    } else {
      this.logger.warn('SMTP is not configured; password reset email delivery is unavailable');
    }
  }

  isConfigured(): boolean {
    return !!this.transport && !!this.from;
  }

  async sendPasswordResetOtp(input: { email: string; firstName: string; otp: string; expiresMinutes: number }): Promise<void> {
    if (!this.transport || !this.from) throw new Error('SMTP is not configured');
    await this.transport.sendMail({
      from: this.from,
      to: input.email,
      subject: 'Your Spectra password reset code',
      text: `Hello ${input.firstName},\n\nYour Spectra password reset code is ${input.otp}. It expires in ${input.expiresMinutes} minutes.\n\nIf you did not request a password reset, you can ignore this email.`,
      html: `<p>Hello ${this.escapeHtml(input.firstName)},</p><p>Your Spectra password reset code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${input.otp}</p><p>This code expires in ${input.expiresMinutes} minutes.</p><p>If you did not request a password reset, you can ignore this email.</p>`,
    });
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
  }
}

@Global()
@Module({ providers: [EmailService], exports: [EmailService] })
export class EmailModule {}
