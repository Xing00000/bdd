import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(process.env.WB_ROOT ?? fileURLToPath(new URL('../..', import.meta.url)));
const { main } = await import(pathToFileURL(path.join(root, 'packages/workstation/cli.mjs')).href);
await main('serve');
