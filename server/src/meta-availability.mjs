import {existsSync,readFileSync} from 'node:fs';

const WEEKDAYS={mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,sun:7};
const WEEKDAY_NAMES=[null,'Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTH_NAMES=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function clock(value){
  if(typeof value!=='string')return null;
  const match=value.match(/^(\d{1,2}):(\d{2})$/);
  if(!match)return null;
  const hour=Number(match[1]),minute=Number(match[2]);
  if(hour>23||minute>59)return null;
  return hour*60+minute;
}
function weekdays(value){
  if(!Array.isArray(value)||!value.length||value.length>7)return null;
  const days=[];
  for(const item of value){
    const day=typeof item==='string'?WEEKDAYS[item.toLowerCase()]:item;
    if(!Number.isInteger(day)||day<1||day>7||days.includes(day))return null;
    days.push(day);
  }
  return days;
}
export function parseAvailability(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))return null;
  if(raw.timezone!=='America/New_York')return null;
  const days=weekdays(raw.weekdays);
  const startMinutes=clock(raw.hours?.start),endMinutes=clock(raw.hours?.end);
  if(!days||startMinutes==null||endMinutes==null||endMinutes<=startMinutes)return null;
  if(!Number.isInteger(raw.slotMinutes)||raw.slotMinutes<15||raw.slotMinutes>480)return null;
  if(endMinutes-startMinutes<raw.slotMinutes)return null;
  if(!Number.isInteger(raw.leadTimeHours)||raw.leadTimeHours<0||raw.leadTimeHours>336)return null;
  return {timezone:'America/New_York',weekdays:days,startMinutes,endMinutes,slotMinutes:raw.slotMinutes,leadTimeHours:raw.leadTimeHours};
}
export function loadAvailability(filePath){
  if(!filePath||!existsSync(filePath))return null;
  try{return parseAvailability(JSON.parse(readFileSync(filePath,'utf8')));}catch{return null;}
}
function localParts(date,timeZone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  let hour=Number(parts.hour);
  const day=Number(parts.day),month=Number(parts.month),year=Number(parts.year);
  if(hour===24)hour=0;
  return {year,month,day,hour,minute:Number(parts.minute)};
}
function zonedToUtc(year,month,day,minutes,timeZone){
  const hour=Math.floor(minutes/60),minute=minutes%60;
  let utc=Date.UTC(year,month-1,day,hour,minute);
  for(let attempt=0;attempt<4;attempt++){
    const parts=localParts(new Date(utc),timeZone);
    const delta=Date.UTC(year,month-1,day,hour,minute)-Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute);
    if(delta===0)break;
    utc+=delta;
  }
  return new Date(utc);
}
function addDays(year,month,day,count){
  const date=new Date(Date.UTC(year,month-1,day)+count*86400000);
  return {year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate()};
}
function isoWeekday(year,month,day){
  const sunday=new Date(Date.UTC(year,month-1,day)).getUTCDay();
  return sunday===0?7:sunday;
}
function clockLabel(hour,minute){
  const period=hour>=12?'PM':'AM';
  return (hour%12||12)+':'+String(minute).padStart(2,'0')+' '+period;
}
function labelFor(start,end,timeZone){
  const opened=localParts(start,timeZone),closed=localParts(end,timeZone);
  return WEEKDAY_NAMES[isoWeekday(opened.year,opened.month,opened.day)]+', '+MONTH_NAMES[opened.month-1]+' '+opened.day+', '+clockLabel(opened.hour,opened.minute)+'\u2013'+clockLabel(closed.hour,closed.minute)+' ET';
}
function prepared(config){
  if(config==null)return null;
  if(config.timezone==='America/New_York'&&Number.isInteger(config.startMinutes)&&Array.isArray(config.weekdays))return config;
  return parseAvailability(config);
}
// Slots are generated only from an owner-supplied schedule. A missing or invalid
// schedule returns null so the conversation can ask for a preferred time instead.
export function nextEstimateSlots(config,now,count=3){
  const schedule=prepared(config);
  if(!schedule||!Number.isInteger(count)||count<1)return null;
  const earliest=now+schedule.leadTimeHours*3600000;
  const origin=localParts(new Date(now),schedule.timezone);
  const slots=[];
  for(let offset=0;offset<21&&slots.length<count;offset++){
    const date=addDays(origin.year,origin.month,origin.day,offset);
    if(!schedule.weekdays.includes(isoWeekday(date.year,date.month,date.day)))continue;
    for(let minute=schedule.startMinutes;minute+schedule.slotMinutes<=schedule.endMinutes&&slots.length<count;minute+=schedule.slotMinutes){
      const start=zonedToUtc(date.year,date.month,date.day,minute,schedule.timezone);
      if(start.getTime()<earliest)continue;
      const end=new Date(start.getTime()+schedule.slotMinutes*60000);
      slots.push({start:start.toISOString(),end:end.toISOString(),label:labelFor(start,end,schedule.timezone)});
    }
  }
  return slots.length?slots:null;
}
