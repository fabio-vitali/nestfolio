import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';

const FENCE_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(content) {
  const m = content.match(FENCE_RE);
  if (!m) return { frontmatter: null, body: content };
  return { frontmatter: parseYaml(m[1]), body: m[2] };
}

export function loadBacklogFiles(dir) {
  return readdirSync(dir)
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => {
      const path = join(dir, f);
      const content = readFileSync(path, 'utf8');
      const { frontmatter, body } = parseFrontmatter(content);
      return { filename: f, id: f.replace(/\.md$/, ''), path, frontmatter, body };
    });
}
