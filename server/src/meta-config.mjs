import {fileURLToPath} from 'node:url';

export function metaSettings(env=process.env){
  return {
    enabled:env.META_INTAKE_ENABLED==='1',
    verifyToken:env.META_VERIFY_TOKEN||'',
    appSecret:env.META_APP_SECRET||'',
    pageAccessToken:env.META_PAGE_ACCESS_TOKEN||'',
    sendMode:env.META_SEND_MODE==='live'?'live':'dry-run',
    graphVersion:/^v\d+\.\d+$/.test(env.META_GRAPH_VERSION||'')?env.META_GRAPH_VERSION:'v21.0',
    availabilityPath:env.META_AVAILABILITY_PATH||fileURLToPath(new URL('../config/estimate-availability.json',import.meta.url)),
    llm:{enabled:env.META_LLM_ENABLED==='1',baseUrl:env.META_LLM_BASE_URL||'',apiKey:env.META_LLM_API_KEY||'',model:env.META_LLM_MODEL||''},
  };
}
