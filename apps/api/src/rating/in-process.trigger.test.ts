import { describe, it, expect, vi } from 'vitest';
import { InProcessRatingJobTrigger } from './in-process.trigger';

vi.mock('@tt-rating/rating-job', () => ({
  processTournament: vi.fn().mockResolvedValue(undefined),
  processCasualMatch: vi.fn().mockResolvedValue(undefined),
}));

describe('InProcessRatingJobTrigger', () => {
  it('routes tournamentId to processTournament', async () => {
    const { processTournament } = await import('@tt-rating/rating-job');
    const trigger = new InProcessRatingJobTrigger({} as any);
    await trigger.trigger({ tournamentId: 't-1' });
    expect(processTournament).toHaveBeenCalledWith('t-1', expect.anything());
  });

  it('routes matchId to processCasualMatch', async () => {
    const { processCasualMatch } = await import('@tt-rating/rating-job');
    const trigger = new InProcessRatingJobTrigger({} as any);
    await trigger.trigger({ matchId: 'm-1' });
    expect(processCasualMatch).toHaveBeenCalledWith('m-1', expect.anything());
  });

  it('rejects when both fields set', async () => {
    const trigger = new InProcessRatingJobTrigger({} as any);
    await expect(
      trigger.trigger({ tournamentId: 't-1', matchId: 'm-1' }),
    ).rejects.toThrow(/exactly one/i);
  });

  it('rejects when neither field set', async () => {
    const trigger = new InProcessRatingJobTrigger({} as any);
    await expect(trigger.trigger({} as any)).rejects.toThrow(/exactly one/i);
  });
});
