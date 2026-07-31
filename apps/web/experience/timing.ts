import type { Mission } from "./contracts";

export function buildElapsedLabel(
  mission: Mission,
  now = Date.now(),
): string | null {
  const { startedAt, completedAt } = mission.executionProjection.timing;
  if (startedAt === null) return null;
  const start = Date.parse(startedAt);
  const end = completedAt === null ? now : Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null;
  }
  const totalSeconds = Math.floor((end - start) / 1_000);
  const visibleSeconds = Math.floor(totalSeconds / 10) * 10;
  if (visibleSeconds < 60) return `${visibleSeconds} sec`;
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  const remainingSeconds = visibleSeconds % 60;
  const secondPart =
    remainingSeconds === 0 ? "" : ` ${remainingSeconds} sec`;
  if (hours === 0) return `${minutes} min${secondPart}`;
  const minutePart =
    remainingMinutes === 0 ? "" : ` ${remainingMinutes} min`;
  return `${hours} hr${minutePart}${secondPart}`;
}
