// Jest transformer: turns imported .txt files into a CommonJS module whose
// default export is the file's text content. Mirrors esbuild's
// --loader:.txt=text behaviour for unit tests.
const fs = require('fs');

module.exports = {
  process(_sourceText, sourcePath) {
    const content = fs.readFileSync(sourcePath, 'utf-8');
    return { code: `module.exports = { default: ${JSON.stringify(content)} };` };
  },
};
