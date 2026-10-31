// Optional phase-2 hook. Phase 1 never calls a model unless META_LLM_ENABLED=1.
// The endpoint is OpenAI-compatible: POST {META_LLM_BASE_URL}/chat/completions.
// The model may only rephrase the deterministic draft. A reply that adds a price
// the draft did not contain is discarded. Any failure keeps the draft.
export async function polishReply(draft,config={},fetchImpl=fetch){
  if(!config?.enabled||!config.baseUrl||!config.model)return draft;
  let endpoint;
  try{endpoint=new URL('chat/completions',config.baseUrl.endsWith('/')?config.baseUrl:config.baseUrl+'/');}
  catch{return draft;}
  if(endpoint.protocol!=='https:')return draft;
  try{
    const response=await fetchImpl(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(2500),headers:{'Content-Type':'application/json',...(config.apiKey?{Authorization:'Bearer '+config.apiKey}:{})},body:JSON.stringify({model:config.model,temperature:0,messages:[{role:'system',content:'Rephrase the draft as a short plain-text reply for Everything Screen and Gutters. Do not add prices, warranties, appointment times, or facts that are not in the draft. If unsure, return the draft unchanged.'},{role:'user',content:draft}]})});
    if(!response.ok)return draft;
    const data=await response.json();
    const text=data?.choices?.[0]?.message?.content;
    if(typeof text!=='string')return draft;
    const cleaned=text.trim();
    if(!cleaned||cleaned.length>1000)return draft;
    if(!draft.includes('$')&&cleaned.includes('$'))return draft;
    return cleaned;
  }catch{return draft;}
}
