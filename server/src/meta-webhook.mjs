import {createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {advanceIntake,buildMetaLead,freshSession} from './meta-intake.mjs';
import {polishReply} from './meta-llm.mjs';

function same(left,right){
  if(left.length!==right.length)return false;
  return timingSafeEqual(left,right);
}
export function verifyTokenEqual(supplied,expected){
  if(typeof supplied!=='string'||typeof expected!=='string'||!expected)return false;
  return same(Buffer.from(supplied),Buffer.from(expected));
}
export function verifyHubSignature(raw,header,secret){
  if(!Buffer.isBuffer(raw)||typeof header!=='string'||typeof secret!=='string'||!secret)return false;
  const match=header.match(/^sha256=([0-9a-fA-F]+)$/);
  if(!match)return false;
  const expected=createHmac('sha256',secret).update(raw).digest('hex');
  return same(Buffer.from(match[1].toLowerCase()),Buffer.from(expected));
}
export function parseMessagingEvents(payload){
  if(!payload||typeof payload!=='object'||!Array.isArray(payload.entry))return [];
  const channel=payload.object==='instagram'?'instagram':payload.object==='page'?'meta_messenger':null;
  if(!channel)return [];
  const events=[];
  for(const entry of payload.entry){
    if(!entry||!Array.isArray(entry.messaging))continue;
    for(const item of entry.messaging){
      const message=item?.message;
      if(!message||message.is_echo||typeof message.mid!=='string'||!message.mid)continue;
      const senderId=item.sender?.id;
      if(typeof senderId!=='string'||!senderId||senderId.length>128)continue;
      events.push({channel,senderId,recipientId:typeof item.recipient?.id==='string'?item.recipient.id:(typeof entry.id==='string'?entry.id:''),mid:message.mid.slice(0,256),text:typeof message.text==='string'?message.text.slice(0,4000):''});
    }
  }
  return events;
}
async function dispatchPending(pending,{store,sender,llm,fetchImpl}){
  for(const item of pending){
    const text=await polishReply(item.body,llm,fetchImpl);
    if(text!==item.body)store.metaReviseOutbound(item.id,text);
    const result=await sender.deliver({...item,text});
    store.metaMarkOutbound(item.id,result.delivery==='live'?'live':'failed');
  }
}
// Local SQLite work finishes before the 200. Live Graph sends are deferred so a
// slow Send API call cannot hold Meta's webhook acknowledgement.
export function ingestMetaEvents({store,events,now,slots,sender,llm,fetchImpl=fetch}){
  const pending=[];
  const at=new Date(now).toISOString();
  store.inTransaction(()=>{
    for(const event of events){
      if(store.metaHas(event.mid))continue;
      const key=event.channel+':'+event.senderId;
      const saved=store.metaLoad(key);
      let session=saved?JSON.parse(saved.state_json):freshSession();
      const outcome=advanceIntake(session,event.text,{slots});
      session=outcome.session;
      if(outcome.completed&&!session.conversationId){
        const lead=buildMetaLead(session,event.channel);
        store.insertConversation(lead);
        store.insertMetaLead({conversationId:lead.conversationId,channel:event.channel,senderId:event.senderId,at});
        session.conversationId=lead.conversationId;
      }
      store.metaSave(key,event.channel,event.senderId,session,at);
      store.metaRemember(event.mid,key,at);
      for(const body of outcome.replies){
        const id=randomUUID();
        store.metaOutbound({id,senderKey:key,mid:event.mid,body,delivery:sender.live?'pending':'dry-run',at});
        if(sender.live)pending.push({id,channel:event.channel,recipientId:event.senderId,pageId:event.recipientId,body});
      }
    }
  });
  if(pending.length)queueMicrotask(()=>{void dispatchPending(pending,{store,sender,llm,fetchImpl});});
  return {ok:true};
}
