import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {collectSEO} from './seo/collect.mjs';

// Fixed private destination: no CLI output path can accidentally publish reports under site/.
const root = fileURLToPath(new URL('../',import.meta.url));
try {
  if (process.argv.length !== 3) throw Error('Usage: node tools/seo-collect.mjs <private-config.json>');
  const config = JSON.parse(await readFile(path.resolve(process.argv[2]),'utf8'));
  const report = await collectSEO(config);
  const directory = path.join(root,'private','seo');
  await mkdir(directory,{recursive:true,mode:0o700});
  const output = path.join(directory,new Date().toISOString().replaceAll(':','-')+'.json');
  await writeFile(output,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Private SEO report saved. '+Object.entries(report.sources).map(([name,source]) => name+': '+source.state).join('; '));
  if (Object.values(report.sources).some(source => ['failed','missing_inputs'].includes(source.state))) process.exitCode=2;
} catch {
  console.error('SEO collection did not complete. Check the private configuration and existing authorized source access.');
  process.exitCode=1;
}
