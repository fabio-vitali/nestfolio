// Text-file imports — the runtime bundle inlines these via esbuild's
// --loader:.txt=text. Unit tests also need the declaration so ts-jest can
// resolve the module at import time (even though the content is mocked).
declare module '*.txt' {
  const content: string;
  export default content;
}
