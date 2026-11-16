import { realpath } from 'node:fs/promises';
import { inspectProjectInstructions } from '../server/application/desktop/projects.ts';
if (!process.argv[2]) throw new Error('Usage: node --import tsx scripts/project-instructions.mjs <sourceRoot> [--content]');
const result = await inspectProjectInstructions(await realpath(process.argv[2]));
console.log(JSON.stringify(process.argv.includes('--content') ? result : { ...result, files: result.files.map(({ content, ...file }) => file) }, null, 2));
if (!result.ready) process.exitCode = 1;
