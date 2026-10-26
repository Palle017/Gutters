import {isIP} from 'node:net';

// Enable forwarded identity only after verifying that the dedicated local proxy
// overwrites the chosen header. Tailscale Serve/Funnel supplies one X-Forwarded-For.
// A browser-supplied chain, malformed value, or non-loopback peer is never trusted.
export function clientIdentity(request, mode = 'false') {
  const peer = request.socket?.remoteAddress;
  if (!isIP(peer || '')) throw Error('Client address unavailable.');
  if (mode === 'false') return peer;
  if (!['true', 'tailscale'].includes(mode)) throw Error('Invalid proxy identity mode.');
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)) throw Error('Proxy is not loopback.');
  const value = request.headers[mode === 'tailscale' ? 'x-forwarded-for' : 'x-real-ip'];
  if (typeof value !== 'string' || !isIP(value) || value.includes('%')) throw Error('Proxy client address unavailable.');
  // Canonicalize IPv6 spellings so equivalent addresses cannot evade rate limits.
  return isIP(value) === 6 ? new URL('http://[' + value + ']/').hostname.slice(1, -1) : value;
}
