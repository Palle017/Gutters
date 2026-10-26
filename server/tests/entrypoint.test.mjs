import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

test('the real service starts through the current release directory symlink',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'gutters-entrypoint-'));
  assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir())+path.sep));
  const serverDirectory=fileURLToPath(new URL('../',import.meta.url));
  const current=path.join(directory,'current');
  await symlink(serverDirectory,current,process.platform==='win32'?'junction':'dir');
  const reservation=net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const child=spawn(process.execPath,[path.join(current,'src/server.mjs')],{
    cwd:current,windowsHide:true,stdio:['ignore','pipe','pipe'],
    env:{...process.env,GUTTERS_BIND_HOST:'127.0.0.1',GUTTERS_PORT:String(port),
      GUTTERS_DB_PATH:path.join(directory,'synthetic.sqlite3'),
      GUTTERS_OWNER_TOKEN:randomBytes(32).toString('base64url'),
      GUTTERS_PUBLIC_ORIGIN:'http://127.0.0.1:'+port,GUTTERS_ALLOWED_ORIGINS:'https://customer.invalid',
      GUTTERS_TRUST_PROXY:'false',GUTTERS_SERVE_SITE:'false'}
  });
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.resume();
  t.after(async()=>{
    if(child.exitCode===null){child.kill();await once(child,'exit');}
    await rm(directory,{recursive:true,force:true});
  });
  for(let count=0;count<100;count++){
    if(output.includes('"listening"'))break;
    assert.equal(child.exitCode,null,'Service must not silently exit when launched through current.');
    await delay(30);
  }
  assert.ok(output.includes('"listening"'),'Startup confirmation is required.');
  const response=await fetch('http://127.0.0.1:'+port+'/healthz');
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{ok:true,service:'gutters-messaging',storage:'sqlite'});
});
