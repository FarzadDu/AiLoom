export function repairRequestIdentity(sourceAssetId: string, startSec: number, endSec: number, prompt: string): string {
  return JSON.stringify({ sourceAssetId, startSec, endSec, prompt: prompt.trim() });
}
