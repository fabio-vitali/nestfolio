#!/usr/bin/env node
import { Level1ApplicationService } from './src/application-service.mjs';

function parse(argv) {
  const [command = 'doctor', ...rest] = argv;
  const options = {};
  const args = [];
  let passthrough = false;
  for (const token of rest) {
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
const service = new Level1ApplicationService(process.cwd());
let result;
switch (command) {
  case 'doctor': result = await service.doctor(); break;
  case 'inspect': result = await service.inspect(); break;
  case 'verify': result = await service.preflight({ claim: options.claim }); break;
  case 'invoke': result = await service.invoke(args, { claim: options.claim }); break;
  case 'activate': result = await service.activate(); break;
  case 'disable': result = await service.setActivation(false); break;
  case 'claim': result = await service.preflight({ claim: options.type ?? args[0] }); break;
  default:
    result = { status: 'blocked', code: 'UNKNOWN_COMMAND', message: `Unknown Level 1 command: ${command}` };
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.status === 'blocked' ? 1 : 0);
