export function getBaseUrl(): string {
  const loc = window.location;
  return `${loc.protocol}//${loc.host}/`;
}
