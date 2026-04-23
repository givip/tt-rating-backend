import { describe, it, expect, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { ConsoleSmsProvider } from './console-sms.provider';

describe('ConsoleSmsProvider', () => {
  it('logs with [DEV SMS] prefix and resolves without error', async () => {
    const warnSpy = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const provider = new ConsoleSmsProvider();
    await expect(provider.send('+15551234567', 'hello')).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [msg] = warnSpy.mock.calls[0];
    expect(String(msg)).toContain('[DEV SMS]');
    expect(String(msg)).toContain('+15551234567');
    expect(String(msg)).toContain('hello');

    warnSpy.mockRestore();
  });
});
