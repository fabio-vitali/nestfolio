import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FENCE_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(content) {
  const m = content.match(FENCE_RE);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: parseYaml(m[1]), body: m[2] };
}

// Total parse boundary: a malformed file (e.g. a duplicate frontmatter key the ship
// steps can produce) must NOT crash the whole run. Each record carries a parseError
// (null when clean); ruleFrontmatterParseable surfaces it located-by-filename.
// parseFrontmatter itself stays single-responsibility (parse or throw); the totality
// lives here, mirroring the dossier-sync guard.
export function loadBacklogFiles(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => {
      const path = join(dir, f);
      const id = f.replace(/\.md$/, '');
      const content = readFileSync(path, 'utf8');
      try {
        const { frontmatter, body } = parseFrontmatter(content);
        return { filename: f, id, path, frontmatter, body, parseError: null };
      } catch (e) {
        return { filename: f, id, path, frontmatter: null, body: content, parseError: e.message.split('\n')[0] };
      }
    });
}
