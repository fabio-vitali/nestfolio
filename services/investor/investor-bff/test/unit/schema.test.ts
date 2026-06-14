import { readFileSync } from 'fs';
import { join } from 'path';
import { parse, type ObjectTypeDefinitionNode, type FieldDefinitionNode, type TypeNode } from 'graphql';

// Regression guard for the go-live e2e finding: confirmGoLive returns InvestorProfile
// and selects `executionMode`, so the InvestorProfile GraphQL type MUST expose that field.
// (The DDB row always carries executionMode — onboarding-completed.ts is the sole writer
// and seeds it to 'simulation'; confirmGoLive flips it to 'live'.) The resolver unit tests
// validate the DDB write shape but not the GraphQL schema surface — this test closes that gap.
const ast = parse(readFileSync(join(__dirname, '../../src/schema.graphql'), 'utf-8'));

function objectType(name: string): ObjectTypeDefinitionNode {
  const def = ast.definitions.find(
    (d): d is ObjectTypeDefinitionNode =>
      d.kind === 'ObjectTypeDefinition' && d.name.value === name,
  );
  if (!def) throw new Error(`type ${name} not found in schema.graphql`);
  return def;
}

function field(type: ObjectTypeDefinitionNode, name: string): FieldDefinitionNode | undefined {
  return (type.fields ?? []).find((f) => f.name.value === name);
}

function namedReturnType(t: TypeNode): string {
  // unwrap NonNull / List wrappers down to the NamedType
  if (t.kind === 'NonNullType' || t.kind === 'ListType') return namedReturnType(t.type);
  return t.name.value;
}

describe('schema.graphql — InvestorProfile surface', () => {
  it('InvestorProfile exposes a non-null executionMode field', () => {
    const f = field(objectType('InvestorProfile'), 'executionMode');
    expect(f).toBeDefined();
    expect(f!.type.kind).toBe('NonNullType'); // String!
    expect(namedReturnType(f!.type)).toBe('String');
  });

  it('confirmGoLive mutation returns InvestorProfile (so executionMode is selectable)', () => {
    const confirmGoLive = field(objectType('Mutation'), 'confirmGoLive');
    expect(confirmGoLive).toBeDefined();
    expect(namedReturnType(confirmGoLive!.type)).toBe('InvestorProfile');
  });
});
