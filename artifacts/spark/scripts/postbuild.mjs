import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../');
const docsDirectory = path.join(repoRoot, 'docs');
await mkdir(docsDirectory, { recursive: true });
await writeFile(path.join(docsDirectory, '.nojekyll'), '');
await copyFile(path.join(docsDirectory, 'index.html'), path.join(docsDirectory, '404.html'));
