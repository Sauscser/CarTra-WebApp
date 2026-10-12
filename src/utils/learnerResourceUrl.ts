export function getLearnerResourceUrl(...values: unknown[]): URL | null {
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const trimmed = value.trim();
    const normalized = trimmed.startsWith('//')
      ? `https:${trimmed}`
      : trimmed.startsWith('www.')
        ? `https://${trimmed}`
        : trimmed;

    try {
      const url = new URL(normalized);
      if (url.protocol === 'http:' || url.protocol === 'https:') return url;
    } catch {
      continue;
    }
  }

  return null;
}

export function isLearnerVideoResource(resource: { externalUrl?: unknown; fileKey?: unknown; resourceType?: unknown }): boolean {
  return resource.resourceType === 'video'
    || Boolean(getLearnerResourceUrl(resource.externalUrl))
    || Boolean(getLearnerResourceUrl(resource.fileKey));
}
