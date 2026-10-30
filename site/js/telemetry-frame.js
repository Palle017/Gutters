(() => {
  'use strict';
  const config = window.GUTTERS_TELEMETRY_CONFIG;
  if (window.parent === window || config?.enabled !== true || !/^G-[A-Z0-9]{6,20}$/.test(config.measurementId || '')) return;
  const paths = new Set(['/', '/about.html', '/contact.html', '/estimate.html', '/services.html', '/gutters.html', '/screens.html', '/projects.html', '/offers.html', '/gutter-advice.html', '/gutter-repairs-cleaning-leaf-guards.html', '/rescreening-restoration.html', '/seamless-super-gutters.html', '/underground-drainage.html', '/boat-canopy-awning-tarps.html']);
  let initialized = false;
  let pageLocation;
  function gtag() { window.dataLayer.push(arguments); }
  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== 'https://wisdomscreen.pro') return;
    const data = event.data;
    if (data?.type === 'gutters.measurement.init.v1') {
      if (initialized || !paths.has(data.path) || !/^\d{1,10}\.\d{1,10}$/.test(data.clientId || '') || Object.keys(data).some(key => !['type', 'path', 'clientId'].includes(key))) return;
      initialized = true;
      pageLocation = 'https://wisdomscreen.pro' + data.path;
      window.dataLayer = [];
      gtag('js', new Date());
      gtag('config', config.measurementId, {send_page_view: false, client_id: data.clientId, page_location: pageLocation, page_referrer: '', page_title: 'Everything Screen and Gutters', allow_google_signals: false, allow_ad_personalization_signals: false, cookie_prefix: 'gutters'});
      const script = document.createElement('script');
      script.async = true;
      script.referrerPolicy = 'no-referrer';
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + config.measurementId;
      document.head.append(script);
      return;
    }
    if (!initialized || data?.type !== 'gutters.measurement.v1' || !['page_view', 'contact_click', 'quote_request_saved'].includes(data.event) || Object.keys(data).some(key => !['type', 'event', 'contact_channel'].includes(key))) return;
    if (data.event === 'contact_click' ? !['phone', 'email', 'sms'].includes(data.contact_channel) : data.contact_channel !== undefined) return;
    const parameters = {send_to: config.measurementId, page_location: pageLocation, page_referrer: '', page_title: 'Everything Screen and Gutters'};
    if (data.event === 'contact_click') parameters.contact_channel = data.contact_channel;
    gtag('event', data.event, parameters);
  });
  window.parent.postMessage({type: 'gutters.measurement.ready.v1'}, 'https://wisdomscreen.pro');
})();
