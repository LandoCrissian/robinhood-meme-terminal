export function resolveArchiveRpcUrl(primaryRpcUrl: string, configuredArchiveRpcUrl?: string) {
  const archiveRpcUrl = configuredArchiveRpcUrl?.trim();
  return archiveRpcUrl || primaryRpcUrl;
}
