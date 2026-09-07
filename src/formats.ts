export function formatBytes(bytes: number): string {
  const value = Math.max(0, Number(bytes) || 0);
  if (value < 1_000) return `${value.toLocaleString()} B`;

  const units = ['KB', 'MB', 'GB', 'TB'];
  let scaled = value / 1_000;
  let unit = units[0];

  for (let index = 1; index < units.length && scaled >= 1_000; index += 1) {
    scaled /= 1_000;
    unit = units[index];
  }

  return `${scaled.toLocaleString(undefined, {
    maximumFractionDigits: scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2,
  })} ${unit}`;
}
