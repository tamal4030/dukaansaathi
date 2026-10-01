import { Resend } from 'resend';
import { env, features, missingEnvFor } from '../config/env';
import { logger } from '../lib/logger';

export type EmailStatus = 'SENT' | 'FAILED' | 'SKIPPED';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export interface EmailResult {
  status: EmailStatus;
  error?: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailResult>;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Resend-backed sender. When credentials are missing the send is reported as
 * SKIPPED - never as sent - and the caller keeps the database record.
 */
export function createEmailSender(): EmailSender {
  return {
    async send(message: EmailMessage): Promise<EmailResult> {
      if (!features.email()) {
        logger.warn('email skipped: provider not configured', { missing: missingEnvFor('email') });
        return { status: 'SKIPPED', error: 'Email provider is not configured (RESEND_API_KEY / EMAIL_FROM).' };
      }
      try {
        const resend = new Resend(env.resendApiKey);
        const response = await resend.emails.send({
          from: env.emailFrom,
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          ...(message.replyTo ? { replyTo: message.replyTo } : {}),
        });
        if (response.error) {
          logger.warn('resend rejected the email', { error: response.error.message });
          return { status: 'FAILED', error: response.error.message };
        }
        return { status: 'SENT' };
      } catch (error) {
        const message_ = (error as Error).message ?? 'Unknown email error';
        logger.warn('email send threw', { error: message_ });
        return { status: 'FAILED', error: message_ };
      }
    },
  };
}

