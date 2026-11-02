/** Shared negotiation contract for task and progress MCP transports. */
export const supportedProtocolVersions=Object.freeze(['2025-03-26','2025-06-18','2025-11-25']);
export function negotiateProtocolVersion(requested) {
  if(typeof requested!=='string'||!requested.trim())throw new Error('Protocol version is required');
  return supportedProtocolVersions.includes(requested)?requested:supportedProtocolVersions.at(-1);
}
