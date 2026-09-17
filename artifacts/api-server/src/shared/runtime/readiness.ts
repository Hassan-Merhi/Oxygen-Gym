let acceptingTraffic = false;

export function markRuntimeReady(): void {
  acceptingTraffic = true;
}

export function markRuntimeDraining(): void {
  acceptingTraffic = false;
}

export function isRuntimeReady(): boolean {
  return acceptingTraffic;
}
