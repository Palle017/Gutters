import {randomBytes,randomUUID} from 'node:crypto';
import {validateCreate} from './protocol.mjs';

export const JOHN_PHONE='239-355-3686';
const STOP=new Set(['stop','unsubscribe']);
const RESTART=new Set(['restart','start over','start again']);
const UNKNOWN_ADDRESS=/^(unknown|not sure|unsure|idk|n\/a|na|skip|don't know|do not know|no address)$/i;
const controls=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

export function freshSession(){
  return {status:'active',step:'scope',jobKind:null,jobDetail:null,name:null,phone:null,address:null,addressKnown:null,estimateWindow:null,scopeAttempts:0,windowMisses:0,conversationId:null};
}
export function validPhone(value){
  if(typeof value!=='string')return false;
  const text=value.trim();
  if(!text||text.length>40||!/^\+?[\d\s().-]+$/.test(text))return false;
  const digits=text.replace(/\D/g,'');
  return digits.length>=10&&digits.length<=15;
}
function clip(value,max){return value.trim().slice(0,max);}
function command(value){return value.trim().toLowerCase().replace(/[.!]+$/g,'');}
function classify(text){
  const value=text.toLowerCase();
  if(/custom screen doors?|screen doors?/.test(value))return 'custom screen doors';
  if(/\bgutters?\b/.test(value))return 'gutters';
  if(/\bscreens?\b|\brescreen(?:ing)?\b/.test(value))return 'screens';
  if(/^\s*other\b/.test(value))return 'other';
  return null;
}
function extraDetail(text){
  const stripped=text.replace(/custom screen doors?|screen doors?|gutters?|screens?|rescreen(?:ing)?|other/ig,' ')
    .replace(/\b(need|needs|i|we|please|looking|for|a|an|the|some|my|our|new|want|wanted)\b/ig,' ')
    .replace(/[^a-z0-9]+/ig,' ').replace(/\s+/g,' ').trim();
  return stripped.length>=3?text.trim():'';
}
function slotLines(slots){return slots.map((slot,index)=>`${index+1}. ${slot.label}`).join('\n');}
function question(session,slots){
  if(session.step==='scope')return 'Hi, this is Everything Screen and Gutters. I can collect a few details for John. What work do you need: gutters, screens, custom screen doors, or other? A short description helps.';
  if(session.step==='detail')return `Thanks. Please send a short description of the ${session.jobKind} work.`;
  if(session.step==='name')return 'What name should John use?';
  if(session.step==='phone')return `What phone number should John call or text? You can also reach him at ${JOHN_PHONE}.`;
  if(session.step==='address')return 'What is the service address for the estimate?';
  if(session.step==='window'&&!slots?.length)return 'What day and time do you prefer for an estimate? John will confirm whether that works. This chat does not book the appointment or give a price.';
  if(session.step==='window')return `John will confirm the estimate time. These openings are from the schedule he saved:\n${slotLines(slots)}\nReply with ${slots.map((_,index)=>index+1).join(', ')}. If none of these work, reply none and John will follow up. This is not a confirmed appointment.`;
  return 'John will confirm the estimate.';
}
function finish(session,replies,completed=false){return {session,replies,completed};}
function complete(session){
  session.status='complete';session.step='done';
  return finish(session,[`Thanks, ${session.name}. John will review this and confirm the estimate. He will not send a price in this chat. If you need him sooner, call or text ${JOHN_PHONE}.`],true);
}
function matchSlot(raw,slots){
  const text=raw.trim().toLowerCase();
  if(/^(none|neither|no|nope|none of these|none of them|none of those|none work|neither works)$/.test(text))return {none:true};
  const number=text.match(/^(?:#)?([1-9])[.!)]?$/);
  if(number){const slot=slots[Number(number[1])-1];return slot?{slot}:null;}
  const found=slots.find(slot=>text===slot.label.toLowerCase());
  return found?{slot:found}:null;
}
function scope(session,raw,slots){
  const kind=classify(raw);
  if(kind){
    session.jobKind=kind;
    const detail=extraDetail(raw);
    if(!detail){session.step='detail';return finish(session,[question(session,slots)]);}
    session.jobDetail=clip(detail,500);session.step='name';
    return finish(session,[question(session,slots)]);
  }
  session.scopeAttempts+=1;
  if(session.scopeAttempts===1)return finish(session,['Please reply with gutters, screens, custom screen doors, or other, and a short description of the work.']);
  session.jobKind='other';session.jobDetail=clip(raw,500);session.step='name';
  return finish(session,[`I'll note this as other work. ${question(session,slots)}`]);
}
function detail(session,raw,slots){
  const kind=classify(raw),extra=kind?extraDetail(raw):raw;
  if(kind&&!extra){session.jobKind=kind;return finish(session,[question(session,slots)]);}
  if(kind)session.jobKind=kind;
  session.jobDetail=clip(extra,500);session.step='name';
  return finish(session,[question(session,slots)]);
}
function name(session,raw,slots){
  if(raw.length>100)return finish(session,['Please send a shorter name, up to 100 characters.']);
  if(validPhone(raw))return finish(session,[question(session,slots)]);
  session.name=raw;session.step='phone';
  return finish(session,[question(session,slots)]);
}
function phone(session,raw,slots){
  if(!validPhone(raw))return finish(session,['That does not look like a phone number John can call. Please send a number with 10 to 15 digits.']);
  session.phone=raw.trim();session.step='address';
  return finish(session,[question(session,slots)]);
}
function address(session,raw,slots){
  if(raw.length>300)return finish(session,['Please send the service address in 300 characters or fewer.']);
  if(UNKNOWN_ADDRESS.test(raw)){session.address=null;session.addressKnown=false;}
  else{session.address=raw;session.addressKnown=true;}
  session.step='window';
  return finish(session,[question(session,slots)]);
}
function windowStep(session,raw,slots){
  if(!slots?.length){
    session.estimateWindow='Customer preferred: '+clip(raw,300)+'. John will confirm.';
    return complete(session);
  }
  const choice=matchSlot(raw,slots);
  if(choice?.none){session.estimateWindow='None of the offered times. John will follow up.';return complete(session);}
  if(choice?.slot){session.estimateWindow=choice.slot.label;return complete(session);}
  session.windowMisses+=1;
  if(session.windowMisses>=2){
    session.estimateWindow='Customer asked for: '+clip(raw,300)+'. John will confirm; this was not one of the saved openings.';
    return complete(session);
  }
  return finish(session,[`Reply with ${slots.map((_,index)=>index+1).join(', ')} to choose one of those openings, or reply none if none of them work.\n${slotLines(slots)}`]);
}
// Deterministic intake. No price is calculated. slots is null when John has not saved a schedule.
export function advanceIntake(session,text,{slots=null}={}){
  const current={...session};
  const raw=typeof text==='string'?text.trim():'';
  if(!raw)return finish(current,['Please describe the work in a text message so John can review it.']);
  if(controls.test(raw))return finish(current,['Please send that again in plain text.']);
  const word=command(raw);
  if(STOP.has(word)){
    current.status='stopped';
    return finish(current,[`Understood. I will stop messages here. Send restart if you want to begin again. You can also call or text John at ${JOHN_PHONE}.`]);
  }
  if(RESTART.has(word))return finish(freshSession(),[question(freshSession(),slots)]);
  if(current.status==='stopped')return finish(current,[`Messages are stopped. Send restart to begin again, or call or text John at ${JOHN_PHONE}.`]);
  if(current.status==='complete')return finish(current,[`John already has this request and will confirm the estimate. Call or text ${JOHN_PHONE} if you need him sooner. Send restart to submit a separate request.`]);
  if(/^(how much|what(?:'s| is) the (?:price|cost)|price\??|cost\??)$/i.test(raw))return finish(current,[`John will confirm the estimate after he reviews the job. This chat does not send a price. ${question(current,slots)}`]);
  if(current.step==='scope')return scope(current,raw,slots);
  if(current.step==='detail')return detail(current,raw,slots);
  if(current.step==='name')return name(current,raw,slots);
  if(current.step==='phone')return phone(current,raw,slots);
  if(current.step==='address')return address(current,raw,slots);
  if(current.step==='window')return windowStep(current,raw,slots);
  return finish(current,[question(current,slots)]);
}
export function leadDetails(session,channel){
  return [(channel==='instagram'?'Instagram message':'Messenger message'),'Source: '+channel,'Job: '+session.jobKind,'Description: '+(session.jobDetail||session.jobKind),'Estimate window: '+session.estimateWindow].join('\n');
}
export function buildMetaLead(session,channel){
  const answers=[
    {field:'name',state:'provided',answer:session.name},
    {field:'phone',state:'provided',answer:session.phone},
    {field:'details',state:'provided',answer:leadDetails(session,channel)},
    session.address?{field:'address',state:'provided',answer:session.address}:{field:'address',state:'unknown'},
    {field:'homeSize',state:'later'},{field:'stories',state:'later'},{field:'gutterLength',state:'later'},
  ];
  const intake=Object.fromEntries(answers.filter(item=>item.state==='provided').map(item=>[item.field,item.answer]));
  return validateCreate({schemaVersion:2,conversationId:randomUUID(),operationId:randomUUID(),accessToken:randomBytes(32).toString('base64url'),intake,answers});
}
