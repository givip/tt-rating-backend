import { Injectable, Logger } from '@nestjs/common';
import { SmsProvider } from './sms-provider.interface';

/**
 * Development-default SMS provider. Logs messages to the server log instead of
 * delivering them. Safe for local dev and tests; do not use in production.
 */
@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  async send(to: string, text: string): Promise<void> {
    this.logger.warn(`[DEV SMS] to=${to}  body=${text}`);
  }
}
