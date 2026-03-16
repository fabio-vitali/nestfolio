function toScreamingSnake(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Builds a `changeDataCapture` eventTypeMap from a list of DynamoDB __typename values.
 * Generates INSERT → _CREATED and MODIFY → _UPDATED mappings using SCREAMING_SNAKE convention.
 * Custom overrides replace convention-based mappings for specific keys.
 */
export function buildEventTypeMap(
  publishableTypes: string[],
  customMap?: Record<string, string>,
): Record<string, string> {
  const map: Record<string, string> = {};
  for (const type of publishableTypes) {
    const screaming = toScreamingSnake(type);
    map[`${type}:INSERT`] = `${screaming}_CREATED`;
    map[`${type}:MODIFY`] = `${screaming}_UPDATED`;
  }
  return { ...map, ...customMap };
}
