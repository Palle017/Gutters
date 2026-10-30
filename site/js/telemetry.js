(() => {
  'use strict';
  const publicPages = new Set(['/', '/index.html', '/about.html', '/contact.html', '/estimate.html', '/services.html', '/gutters.html', '/screens.html', '/projects.html', '/offers.html', '/gutter-advice.html', '/gutter-repairs-cleaning-leaf-guards.html', '/rescreening-restoration.html', '/seamless-super-gutters.html', '/underground-drainage.html', '/boat-canopy-awning-tarps.html']);
  const config = window.GUTTERS_TELEMETRY_CONFIG;
  // A preview, unknown route, private customer page, or unset property cannot send.
  if (location.origin !== 'https://wisdomscreen.pro' || !publicPages.has(location.pathname) || config?.enabled !== true || !/^G-[A-Z0-9]{6,20}$/.test(config.measurementId || '') || navigator.globalPrivacyControl === true || navigator.doNotTrack === '1') return;

  let clientId;
  try {
    const key = 'gutters.analytics-session.v1';
    clientId = sessionStorage.getItem(key);
    if (!/^\d{1,10}\.\d{1,10}$/.test(clientId || '')) {
      const random = crypto.getRandomValues(new Uint32Array(2));
      clientId = random[0] + '.' + random[1];
      sessionStorage.setItem(key, clientId);
    }
  } catch { return; } // Analytics storage failure must never interfere with intake.

  // The Google tag runs in an opaque sandbox. It cannot read the estimate DOM,
  // customer session storage, photos, capability links, cookies, or owner keys.
  const frame = document.createElement('iframe');
  frame.hidden = true;
  frame.title = 'Anonymous site measurements';
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.referrerPolicy = 'no-referrer';
  const queue = [];
  let ready = false;
  const send = (event, channel) => {
    const payload = {type: 'gutters.measurement.v1', event};
    if (event === 'contact_click') payload.contact_channel = channel;
    if (ready) frame.contentWindow.postMessage(payload, '*');
    else if (queue.length < 50) queue.push(payload);
  };
  window.addEventListener('message', event => {
    if (event.source !== frame.contentWindow || event.origin !== 'null' || event.data?.type !== 'gutters.measurement.ready.v1' || ready) return;
    frame.contentWindow.postMessage({type: 'gutters.measurement.init.v1', path: location.pathname === '/index.html' ? '/' : location.pathname, clientId}, '*');
    ready = true;
    send('page_view');
    for (const payload of queue.splice(0)) frame.contentWindow.postMessage(payload, '*');
  });
  frame.src = 'telemetry-frame.html'; // No query, fragment, referrer, or private URL.
  document.body.append(frame);

  document.addEventListener('click', event => {
    const link = event.target.closest?.('a[href]');
    const href = link?.getAttribute('href') || '';
    // Only the fixed channel leaves the page; destination and link text never do.
    const channel = href.startsWith('tel:') ? 'phone' : href.startsWith('mailto:') ? 'email' : href.startsWith('sms:') ? 'sms' : '';
    if (channel) send('contact_click', channel);
  });
  window.GuttersTelemetry = Object.freeze({requestSaved() { send('quote_request_saved'); }});
})();
