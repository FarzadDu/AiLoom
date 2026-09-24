import type { getGenerationJob } from "./jobs";

export function publicJob(job: NonNullable<ReturnType<typeof getGenerationJob>>) {
  return {
    id: job.id,
    kind: job.kind,
    provider: job.provider,
    providerModel: job.providerModel,
    state: job.state,
    costEstimateMicrosUsd: job.costEstimateMicrosUsd,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    output: job.output
  };
}
