import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicHost, isBlockedHostname, isPrivateIp } from '../src/guards.ts';
import { BlockedHostError } from '@wakeelcheck/core';

test('blocks the cloud metadata endpoint', () => {
  // أشهر هدف لهجمات SSRF: يسرّب بيانات اعتماد الخادم.
  assert.equal(isPrivateIp('169.254.169.254'), true);
});

test('blocks every reserved IPv4 range', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '10.255.255.255',
    '100.64.0.1', // CGNAT
    '127.0.0.1',
    '127.255.255.254',
    '169.254.1.1',
    '172.16.0.1',
    '172.31.255.255',
    '192.0.2.1', // TEST-NET-1
    '192.168.1.1',
    '198.18.0.1', // benchmark
    '198.51.100.1', // TEST-NET-2
    '203.0.113.1', // TEST-NET-3
    '224.0.0.1', // multicast
    '255.255.255.255',
  ];

  for (const ip of blocked) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be blocked`);
  }
});

test('allows genuinely public IPv4', () => {
  const allowed = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '11.0.0.1'];

  for (const ip of allowed) {
    assert.equal(isPrivateIp(ip), false, `${ip} must be allowed`);
  }
});

test('blocks reserved IPv6', () => {
  const blocked = [
    '::',
    '::1', // loopback
    'fc00::1', // ULA
    'fd12:3456:789a::1', // ULA
    'fe80::1', // link-local
    'ff02::1', // multicast
    '::ffff:127.0.0.1', // IPv4-mapped loopback
    '::ffff:169.254.169.254', // IPv4-mapped metadata
    '64:ff9b::10.0.0.1', // NAT64 wrapping a private v4
    '2002:c0a8:0101::1', // 6to4
  ];

  for (const ip of blocked) {
    assert.equal(isPrivateIp(ip), true, `${ip} must be blocked`);
  }
});

test('allows public IPv6', () => {
  assert.equal(isPrivateIp('2606:4700:4700::1111'), false); // Cloudflare
  assert.equal(isPrivateIp('2001:4860:4860::8888'), false); // Google
});

test('rejects anything that is not a valid address', () => {
  for (const bad of ['', 'not-an-ip', '999.1.1.1', '1.2.3', '1.2.3.4.5', 'fg::1']) {
    assert.equal(isPrivateIp(bad), true, `${bad} must fall back to blocked`);
  }
});

test('blocks local hostnames before any DNS lookup', () => {
  for (const host of [
    'localhost',
    'LOCALHOST',
    'api.localhost',
    'db.internal',
    'printer.local',
    'router.home.arpa',
  ]) {
    assert.equal(isBlockedHostname(host), true, `${host} must be blocked`);
  }
});

test('does not block ordinary store domains', () => {
  for (const host of ['example.com', 'salla.sa', 'my-store.zid.store', 'localhost.example.com']) {
    assert.equal(isBlockedHostname(host), false, `${host} must be allowed`);
  }
});

test('assertPublicHost rejects a literal private IP', async () => {
  await assert.rejects(() => assertPublicHost('169.254.169.254'), BlockedHostError);
  await assert.rejects(() => assertPublicHost('127.0.0.1'), BlockedHostError);
  await assert.rejects(() => assertPublicHost('[::1]'), BlockedHostError);
});

test('assertPublicHost rejects localhost', async () => {
  await assert.rejects(() => assertPublicHost('localhost'), BlockedHostError);
});

test('assertPublicHost rejects an empty hostname', async () => {
  await assert.rejects(() => assertPublicHost(''), BlockedHostError);
});

test('assertPublicHost rejects a name that does not resolve', async () => {
  await assert.rejects(
    () => assertPublicHost('this-host-should-never-exist-9f3a2b.invalid'),
    BlockedHostError
  );
});
