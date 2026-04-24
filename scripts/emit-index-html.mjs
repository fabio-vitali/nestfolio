#!/usr/bin/env node
// Emits apps/nestfolio-host/src/index.html from a template + csp.txt.
// Fails hard on any input problem so misconfiguration cannot silently ship.

import { readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { argv, exit, stderr } from 'node:process';

function fail(msg) {
  stderr.write(`emit-index-html: ${msg}\n`);
  exit(1);
}

const [, , templatePath, cspPath, outputPath] = argv;

if (!templatePath || !cspPath || !outputPath) {
  fail('usage: emit-index-html.mjs <template> <csp-file> <output>');
}

if (!existsSync(templatePath)) fail(`template not found: ${templatePath}`);
if (!existsSync(cspPath)) fail(`csp file not found: ${cspPath}`);

const template = readFileSync(templatePath, 'utf-8');
const csp = readFileSync(cspPath, 'utf-8').trim();

if (csp.length === 0) fail(`csp file is empty: ${cspPath}`);

const placeholderCount = (template.match(/\{\{CSP\}\}/g) ?? []).length;
if (placeholderCount === 0) fail(`placeholder {{CSP}} missing in template: ${templatePath}`);
if (placeholderCount > 1) {
  fail(`placeholder {{CSP}} appears ${placeholderCount} times in template (expected 1): ${templatePath}`);
}

const substituted = template.replace('{{CSP}}', csp);

const lines = substituted.split('\n');
const banner = '    <!-- Generated from index.html.tmpl + csp.txt. DO NOT EDIT. -->';
const withBanner = [lines[0], banner, ...lines.slice(1)].join('\n');

const tmp = `${outputPath}.tmp`;
writeFileSync(tmp, withBanner, 'utf-8');
renameSync(tmp, outputPath);
