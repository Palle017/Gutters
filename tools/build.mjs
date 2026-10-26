import {cp, mkdir, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'site');
const output = path.join(root, 'dist');
const allowed = new Set(['.html','.css','.js','.mjs','.svg','.png','.jpg','.jpeg','.webp','.ico','.txt','.xml','.woff2']);
const files = [];
async function inspect(directory, prefix='') {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw Error('Static source cannot contain symlinks.');
    if (entry.isDirectory()) await inspect(path.join(directory,entry.name),relative);
    else {
      if (!allowed.has(path.extname(entry.name).toLowerCase()) || /(?:^|\/)(?:\.env|data|private|server)(?:\/|$)/.test(relative)) throw Error(`Not a public asset: ${relative}`);
      files.push(relative);
    }
  }
}
await inspect(source);
if (!files.includes('index.html')) throw Error('Missing homepage.');
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
await cp(source,output,{recursive:true});
await writeFile(path.join(output,'.nojekyll'),'');
await writeFile(path.join(output,'build-manifest.json'),JSON.stringify({files:files.sort()},null,2)+'\n');
console.log(`Prepared ${files.length} public assets in dist; server code and SQLite are excluded.`);
