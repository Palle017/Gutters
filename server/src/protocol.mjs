import {createHash, timingSafeEqual} from 'node:crypto';

export const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const CAPABILITY = /^[A-Za-z0-9_-]{43}$/;
export const QUESTIONS = Object.freeze([
  {field:'name',prompt:'What name should John use?',max:100},
  {field:'phone',prompt:'What phone number should John call?',max:40},
  {field:'details',prompt:'What screen or gutter work do you need?',max:4000},
  {field:'address',prompt:'What is the address for the work?',max:300},
  {field:'homeSize',prompt:'What is the home size, if you know it?',max:100},
  {field:'stories',prompt:'Is the home single story or double story?',max:1},
  {field:'gutterLength',prompt:'What is the gutter length, if you know it?',max:100},
].map(Object.freeze));
export const FIELDS = QUESTIONS.map(x=>x.field);
export const sha = value => createHash('sha256').update(value).digest('hex');
export const equal = (a,b) => typeof a==='string' && typeof b==='string' && timingSafeEqual(Buffer.from(sha(a)),Buffer.from(sha(b)));
export const fail = (status,code) => Object.assign(new Error(code),{status,code});
const controls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const object = value => value && typeof value==='object' && !Array.isArray(value);
export function exactKeys(value,allowed) {
  if (!object(value) || Object.keys(value).some(key=>!allowed.includes(key))) throw fail(400,'invalid_fields');
}
export function clean(value,max,{required=true}={}) {
  if (typeof value!=='string') throw fail(400,'invalid_text');
  const text=value.trim();
  if ((required&&!text) || text.length>max || controls.test(text)) throw fail(400,'invalid_text');
  return text;
}
export function validateCreate(input) {
  exactKeys(input,['schemaVersion','conversationId','operationId','accessToken','intake','answers']);
  if (input.schemaVersion!==2 || !UUID.test(input.conversationId) || !UUID.test(input.operationId) || !CAPABILITY.test(input.accessToken)) throw fail(400,'invalid_request');
  if (!Array.isArray(input.answers) || input.answers.length>QUESTIONS.length) throw fail(400,'invalid_answers');
  const byField=new Map(); let previous=-1;
  for (const choice of input.answers) {
    exactKeys(choice,['field','state','answer']);
    const index=FIELDS.indexOf(choice.field);
    if (index<=previous || index<0 || byField.has(choice.field)) throw fail(400,'invalid_answer_order');
    previous=index;
    const question=QUESTIONS[index],required=['name','phone'].includes(choice.field);
    if (!['provided','unknown','later'].includes(choice.state)) throw fail(400,'invalid_answer_state');
    if (choice.state!=='provided') {
      if (required || Object.hasOwn(choice,'answer')) throw fail(400,'invalid_answer_state');
      byField.set(choice.field,{field:choice.field,state:choice.state}); continue;
    }
    const answer=clean(choice.answer,question.max);
    if (choice.field==='phone' && (!/^\+?[\d\s().-]+$/.test(answer) || !/^\d{10,15}$/.test(answer.replace(/\D/g,'')))) throw fail(400,'invalid_phone');
    if (choice.field==='stories' && !['1','2'].includes(answer)) throw fail(400,'invalid_stories');
    byField.set(choice.field,{field:choice.field,state:'provided',answer});
  }
  for (const field of ['name','phone']) if (byField.get(field)?.state!=='provided') throw fail(400,'contact_required');
  const answers=QUESTIONS.map(({field})=>byField.get(field)||{field,state:'later'});
  const intake=Object.fromEntries(answers.filter(x=>x.state==='provided').map(x=>[x.field,x.answer]));
  exactKeys(input.intake,FIELDS);
  if (JSON.stringify(Object.keys(input.intake).sort())!==JSON.stringify(Object.keys(intake).sort()) || Object.keys(intake).some(key=>input.intake[key]!==intake[key])) throw fail(400,'intake_mismatch');
  const canonical={schemaVersion:2,intake,answers};
  return {...input,intake,answers,hash:sha(JSON.stringify(canonical)),tokenHash:sha(input.accessToken)};
}
export function validateMessage(input) {
  exactKeys(input,['operationId','body']);
  if (!UUID.test(input.operationId)) throw fail(400,'invalid_operation');
  return {operationId:input.operationId,body:clean(input.body,4000)};
}
export function validateQuote(input) {
  exactKeys(input,['address','size_of_home','stories','gutter_length']);
  if (Object.keys(input).length!==4) throw fail(400,'quote_fields_required');
  const quote={};
  for (const [field,max] of [['address',300],['size_of_home',100],['gutter_length',100]]) quote[field]=input[field]===null?null:clean(input[field],max,{required:false})||null;
  if (![null,1,2].includes(input.stories)) throw fail(400,'invalid_stories');
  quote.stories=input.stories; return quote;
}
export function bearer(request) {
  const header=request.headers.get('authorization')||'';
  return /^Bearer [A-Za-z0-9_-]{43}$/.test(header)?header.slice(7):null;
}
