import { WORKER_NAMES, workerHealthy, type WorkerName } from "../src/server/worker-health";

const name = process.argv[2];
if (!WORKER_NAMES.includes(name as WorkerName)) {
  process.exitCode = 2;
} else if (!await workerHealthy(name as WorkerName)) {
  process.exitCode = 1;
}
