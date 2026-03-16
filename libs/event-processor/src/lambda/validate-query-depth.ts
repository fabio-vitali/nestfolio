/**
 * Validates that a GraphQL selection set doesn't exceed maximum nesting depth.
 * AppSync sends the selection set info in the event — we check the depth.
 */
export function validateQueryDepth(
  selectionSetGraphQL: string | undefined,
  maxDepth: number = 10,
): void {
  if (!selectionSetGraphQL) return;

  let depth = 0;
  let maxFound = 0;
  for (const char of selectionSetGraphQL) {
    if (char === '{') {
      depth++;
      if (depth > maxFound) maxFound = depth;
    } else if (char === '}') {
      depth--;
    }
  }

  if (maxFound > maxDepth) {
    throw new Error(`Query depth ${maxFound} exceeds maximum allowed depth of ${maxDepth}`);
  }
}
