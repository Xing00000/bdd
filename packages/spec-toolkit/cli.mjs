import { createGit } from '../git-core/index.mjs';
import { validate } from './index.mjs';
import { runBddCommand } from './engine.mjs';
import { errorResult } from '../contracts/index.mjs';
const [command, requirementId, featureId] = process.argv.slice(2);
try {
  if (command === 'validate') {
    const result = await validate(process.cwd(), createGit());
    process.stdout.write(JSON.stringify({ valid: result.valid, features: result.features.length, projects: result.modules.length }) + '\n');
  } else {
    const result = await runBddCommand(process.cwd(), command, requirementId, featureId);
    process.stdout.write(result.stdout); process.stderr.write(result.stderr);
    process.exitCode = result.exitCode === 0 && !result.timedOut && !result.overflow ? 0 : 1;
  }
} catch (error) { process.stderr.write(JSON.stringify(errorResult(error)) + '\n'); process.exitCode = 1; }
