#!/usr/bin/env node
import { Level2ApplicationService } from './src/application-service.mjs';

function parse(argv) {
  const [command = 'pack-list', ...tokens] = argv;
  const options = {};
  const args = [];
  let passthrough = false;
  for (const token of tokens) {
    if (token === '--') { passthrough = true; continue; }
    if (passthrough) { args.push(token); continue; }
    const match = token.match(/^--([^=]+)=(.*)$/);
    if (match) options[match[1]] = match[2];
    else if (token.startsWith('--')) options[token.slice(2)] = true;
    else args.push(token);
  }
  return { command, options, args };
}

const { command, options, args } = parse(process.argv.slice(2));
const service = new Level2ApplicationService(process.cwd());
let result;
switch (command) {
  case 'pack-list': result = await service.list(); break;
  case 'pack-install': result = await service.install({ expectedPredecessor: options.expected, actor: options.actor ?? 'local-workspace-owner' }); break;
  case 'pack-resolve': result = await service.resolve(args[0]); break;
  case 'pack-verify': result = await service.verify({ claim: options.claim }); break;
  case 'procedure-compare': result = await service.compare(); break;
  case 'procedure-run': result = await service.run(args[0], options.repo ?? args[1] ?? process.cwd()); break;
  case 'pack-self-validate': result = await service.selfValidate(args[0]); break;
  case 'history': result = await service.history(); break;
  case 'rollback': result = await service.rollback({ expectedActive: options.expected, recoveryRoot: options.recovery, actor: options.actor ?? 'local-workspace-owner' }); break;
  default: result = { status: 'blocked', code: 'UNKNOWN_COMMAND', message: `Unknown Level 2 command: ${command}` };
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'blocked' ? 1 : 0);
