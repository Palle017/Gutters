import test from 'node:test';
import assert from 'node:assert/strict';
import {clientIdentity} from '../src/client-ip.mjs';

const request = (headers = {}, peer = '127.0.0.1') => ({headers, socket: {remoteAddress: peer}});
test('forwarded identity is ignored until explicitly enabled for the local proxy', () => {
  assert.equal(clientIdentity(request({'x-forwarded-for': '203.0.113.10', 'x-real-ip': '203.0.113.11'})), '127.0.0.1');
  assert.equal(clientIdentity(request({'x-forwarded-for': '203.0.113.10'}, '192.0.2.10')), '192.0.2.10');
  assert.throws(() => clientIdentity(request(), 'guess'));
});
test('Tailscale identity uses a single overwritten X-Forwarded-For value and rejects forged chains', () => {
  assert.equal(clientIdentity(request({'x-forwarded-for': '203.0.113.10', 'x-real-ip': '203.0.113.11'}), 'tailscale'), '203.0.113.10');
  assert.equal(clientIdentity(request({'x-forwarded-for': '2001:0db8:0000::1'}, '::1'), 'tailscale'), '2001:db8::1');
  for (const value of [undefined, '', '203.0.113.10, 203.0.113.11', ['203.0.113.10'], ' 203.0.113.10', '203.0.113.10:1234', 'not-an-ip', 'fe80::1%eth0']) {
    assert.throws(() => clientIdentity(request({'x-forwarded-for': value}), 'tailscale'));
  }
  assert.throws(() => clientIdentity(request({'x-forwarded-for': '203.0.113.10'}, '192.0.2.10'), 'tailscale'));
});
test('the existing explicit X-Real-IP mode does not implicitly trust X-Forwarded-For', () => {
  assert.equal(clientIdentity(request({'x-real-ip': '203.0.113.11'}), 'true'), '203.0.113.11');
  assert.throws(() => clientIdentity(request({'x-forwarded-for': '203.0.113.10'}), 'true'));
});
