export interface SmsProvider {
  readonly name: string;
  /** Sends a text message. Should not throw on delivery failure; log and return. */
  send(to: string, text: string): Promise<void>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
