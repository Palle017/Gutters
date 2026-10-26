import {parentPort,workerData} from 'node:worker_threads';
import {openStore} from '../src/store.mjs';
import {validateCreate} from '../src/protocol.mjs';
const store=openStore(workerData.filename);
try{parentPort.postMessage(store.create(validateCreate(workerData.input)));}finally{store.close();}
