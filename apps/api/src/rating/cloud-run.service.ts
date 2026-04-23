import { Injectable } from '@nestjs/common';

@Injectable()
export class CloudRunService {
  async triggerRatingJob(tournamentId: string): Promise<void> {
    const projectId = process.env.GCP_PROJECT_ID;
    const region = process.env.GOOGLE_CLOUD_REGION ?? 'europe-west3';
    const jobName = process.env.CLOUD_RUN_JOB_NAME ?? 'ttrge-rating-worker';

    if (!projectId) {
      console.log(`[DEV] Rating job would be triggered for tournament: ${tournamentId}`);
      return;
    }

    // Dynamic import to avoid requiring @google-cloud/run at build time
    const { JobsClient } = await import('@google-cloud/run').catch(() => {
      throw new Error('@google-cloud/run not installed — add to deps for production');
    });

    const client = new JobsClient();
    const jobPath = client.jobPath(projectId, region, jobName);
    await client.runJob({
      name: jobPath,
      overrides: {
        containerOverrides: [
          { env: [{ name: 'TOURNAMENT_ID', value: tournamentId }] },
        ],
      },
    });
  }
}
