import {validateEmail,UUID} from './protocol.mjs';

export function notificationConfig(env=process.env) {
  if(!env.GUTTERS_EMAIL_ENABLED||env.GUTTERS_EMAIL_ENABLED==='false')return null;
  if(env.GUTTERS_EMAIL_ENABLED!=='true')throw Error('GUTTERS_EMAIL_ENABLED must be true or false.');
  const from=validateEmail(env.GUTTERS_EMAIL_FROM),to=validateEmail(env.GUTTERS_EMAIL_TO);
  const apiKey=env.GUTTERS_RESEND_API_KEY;
  if(typeof apiKey!=='string'||!/^re_[A-Za-z0-9_-]{10,180}$/.test(apiKey))throw Error('Configure the dedicated email sender key before enabling alerts.');
  return Object.freeze({from,to,apiKey});
}

export function notificationPayload(contact,kind,message,settings,ownerOrigin) {
  const from=validateEmail(settings.from),to=validateEmail(settings.to);
  const url=new URL(ownerOrigin);
  if(url.origin!==ownerOrigin||url.username||url.password||url.protocol!=='https:')throw Error('Owner email links require the canonical HTTPS service origin.');
  const replyTo=contact.email?validateEmail(contact.email):null;
  const text=[kind==='new_request'?'A new website inquiry is saved.':'A customer replied to a saved inquiry.',
    'Name: '+contact.name,'Callback: '+contact.phone,
    replyTo?'Reply to this email to contact the customer at '+replyTo+'.':'No reply email was provided. Use the callback number.',
    '',(message||'No project description provided.').slice(0,4000),'',
    'Open your private inbox: '+ownerOrigin+'/owner',
    'Photos may still be uploading. Open the inbox for the latest details.',
    'Replies from your email app go directly to the customer and do not appear on the website conversation.'].join('\n');
  return {from,to:[to],subject:kind==='new_request'?'New website inquiry — Everything Screen and Gutters':'Customer reply — Everything Screen and Gutters',text,...(replyTo?{reply_to:replyTo}:{})};
}

// Source-only until explicitly configured. Each stored payload/key stays unchanged
// across retries; the provider's 24-hour key retention is bounded here to 23 hours.
export async function dispatchNotification(store,config,{fetchImpl=fetch}={}) {
  if(!config)return false;
  const row=store.claimNotification();if(!row)return false;
  const payload=JSON.parse(row.payload_json);
  if(payload.from!==config.from||payload.to.length!==1||payload.to[0]!==config.to){store.finishNotification(row,{status:'failed',code:'sender_configuration_changed'});return true;}
  let result={status:'retry',code:'delivery_unconfirmed'};
  try {
    const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',redirect:'error',
      headers:{Authorization:'Bearer '+config.apiKey,'Content-Type':'application/json','Idempotency-Key':'gutters-owner/'+row.id},
      body:row.payload_json,signal:AbortSignal.timeout(10000)});
    if(response.ok){const data=await response.json();if(typeof data.id==='string'&&UUID.test(data.id))result={status:'accepted',providerId:data.id};}
    else if(response.status>=400&&response.status<500&&response.status!==429)result={status:'failed',code:'provider_rejected'};
    else {
      const retry=response.headers.get('Retry-After');
      const seconds=/^\d{1,6}$/.test(retry||'')?Number(retry):0;
      result.retryAfter=seconds*1000;
    }
  }catch{/* Never log credentials, provider bodies, customer text or exception URLs. */}
  store.finishNotification(row,result);return true;
}

export function startNotificationWorker(store,config) {
  if(!config)return async()=>{};
  let stopped=false,timer,inFlight=Promise.resolve();
  const tick=()=>{inFlight=dispatchNotification(store,config).catch(()=>{}).finally(()=>{if(!stopped){timer=setTimeout(tick,5000);timer.unref();}});};
  timer=setTimeout(tick,0);timer.unref();
  return async()=>{stopped=true;clearTimeout(timer);await inFlight;};
}
