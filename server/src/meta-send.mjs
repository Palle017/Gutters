// Outbound Meta replies. Dry-run is the default: nothing is sent unless mode is
// live and a page access token is configured. The token stays in the Authorization
// header and is never written to the URL or the stored reply.
export function createMetaSender({mode='dry-run',token='',graphVersion='v21.0',fetchImpl=fetch}={}){
  const live=mode==='live'&&typeof token==='string'&&token.length>0;
  const version=/^v\d+\.\d+$/.test(graphVersion)?graphVersion:'v21.0';
  return {live,async deliver({channel,recipientId,pageId,text}){
    if(!live)return {delivery:'dry-run'};
    const url=channel==='instagram'&&pageId
      ?`https://graph.facebook.com/${version}/${encodeURIComponent(pageId)}/messages`
      :`https://graph.facebook.com/${version}/me/messages`;
    const payload={recipient:{id:recipientId},message:{text}};
    if(channel!=='instagram')payload.messaging_type='RESPONSE';
    try{
      const response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(2500)});
      return {delivery:response.ok?'live':'failed'};
    }catch{return {delivery:'failed'};}
  }};
}
