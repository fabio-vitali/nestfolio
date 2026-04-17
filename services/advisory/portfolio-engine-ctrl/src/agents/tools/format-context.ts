export const MAX_SECTION_BYTES = 4096;

export function formatToolContext(sections: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [label, data] of Object.entries(sections)) {
    const body = data === null || data === undefined
      ? 'none'
      : JSON.stringify(data, null, 2);
    const truncated = body.length > MAX_SECTION_BYTES
      ? `${body.slice(0, MAX_SECTION_BYTES)}\n... [truncated]`
      : body;
    parts.push(`\n\n${label}:\n${truncated}`);
  }
  return parts.join('');
}
