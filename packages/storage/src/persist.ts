// Storage persistence. Without it, browsers (iOS Safari especially) may evict
// local files under storage pressure. Installed PWAs are usually granted it.

export async function requestPersistence(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  if (await navigator.storage.persisted()) return true;
  return navigator.storage.persist();
}

export async function storageEstimate(): Promise<{ used: number; quota: number } | null> {
  const e = await navigator.storage?.estimate?.();
  return e ? { used: e.usage ?? 0, quota: e.quota ?? 0 } : null;
}
