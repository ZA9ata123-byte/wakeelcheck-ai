import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupFor, isAllowed, isNamed, parseRobots } from '../src/robots.ts';

/**
 * الحالات الأربع التي أثبتت عطب المحرّك القديم.
 *
 * المنطق السابق كان `hasRobots && (!txt.includes('gptbot') || !txt.includes('disallow: /'))`
 * فأعطى: المثالي راسب، والأسوأ ناجح. هذه الحالات هي معيار القبول.
 */
const CASES = {
  welcomes: 'User-agent: GPTBot\nAllow: /\n\nUser-agent: *\nDisallow: /cart\n',
  blocks: 'User-agent: GPTBot\nDisallow: /\n',
  silent: 'User-agent: *\nDisallow: /admin\n',
  blocksAll: 'User-agent: *\nDisallow: /\n',
};

test('a store that welcomes GPTBot is allowed', () => {
  assert.equal(isAllowed(parseRobots(CASES.welcomes), 'GPTBot', '/'), true);
});

test('a store that blocks GPTBot is not allowed', () => {
  assert.equal(isAllowed(parseRobots(CASES.blocks), 'GPTBot', '/'), false);
});

test('a store that never mentions GPTBot falls back to the wildcard group', () => {
  const robots = parseRobots(CASES.silent);

  assert.equal(isAllowed(robots, 'GPTBot', '/'), true, 'root is open');
  assert.equal(isAllowed(robots, 'GPTBot', '/admin'), false, 'but /admin is not');
  assert.equal(isNamed(robots, 'GPTBot'), false, 'and it was never named');
});

test('a store that blocks everyone is not allowed — the old bug', () => {
  // هذه بالضبط الحالة التي كان المحرّك القديم يمنحها «ناجح».
  assert.equal(isAllowed(parseRobots(CASES.blocksAll), 'GPTBot', '/'), false);
});

test('an explicit welcome is distinguishable from silence', () => {
  assert.equal(isNamed(parseRobots(CASES.welcomes), 'GPTBot'), true);
  assert.equal(isNamed(parseRobots(CASES.silent), 'GPTBot'), false);
});

test('a missing or empty file means no restrictions', () => {
  for (const input of [null, '', '   \n\n  ']) {
    assert.equal(isAllowed(parseRobots(input), 'GPTBot', '/'), true);
  }
});

test('a new User-agent after a rule starts a new group', () => {
  const robots = parseRobots(
    'User-agent: GPTBot\nDisallow: /\nUser-agent: PerplexityBot\nAllow: /\n'
  );

  assert.equal(robots.groups.length, 2);
  assert.equal(isAllowed(robots, 'GPTBot', '/'), false);
  assert.equal(isAllowed(robots, 'PerplexityBot', '/'), true);
});

test('consecutive User-agent lines share one group', () => {
  const robots = parseRobots('User-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /private\n');

  assert.equal(robots.groups.length, 1);
  assert.equal(isAllowed(robots, 'GPTBot', '/private'), false);
  assert.equal(isAllowed(robots, 'ClaudeBot', '/private'), false);
  assert.equal(isAllowed(robots, 'ClaudeBot', '/'), true);
});

test('the longest matching path rule wins', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /products\nAllow: /products/public\n');

  assert.equal(isAllowed(robots, 'GPTBot', '/products/secret'), false);
  assert.equal(isAllowed(robots, 'GPTBot', '/products/public/a'), true);
});

test('Allow wins a tie of equal length', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /shop\nAllow: /shop\n');
  assert.equal(isAllowed(robots, 'GPTBot', '/shop'), true);
});

test('an empty Disallow means allow everything', () => {
  assert.equal(isAllowed(parseRobots('User-agent: *\nDisallow:\n'), 'GPTBot', '/anything'), true);
});

test('wildcards and end anchors are honoured', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow: /tmp/*/cache\n');

  assert.equal(isAllowed(robots, 'GPTBot', '/report.pdf'), false);
  assert.equal(isAllowed(robots, 'GPTBot', '/report.pdf.html'), true, '$ anchors the end');
  assert.equal(isAllowed(robots, 'GPTBot', '/tmp/a/cache'), false);
});

test('the most specific agent name wins over the wildcard', () => {
  const robots = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: GPTBot\nAllow: /\n');

  assert.equal(isAllowed(robots, 'GPTBot', '/'), true, 'named group beats wildcard');
  assert.equal(isAllowed(robots, 'SomeOtherBot', '/'), false, 'others still blocked');
});

test('agent matching is by prefix', () => {
  const robots = parseRobots('User-agent: googlebot\nDisallow: /\n');
  const group = groupFor(robots, 'Googlebot-News');

  assert.notEqual(group, null);
  assert.equal(isAllowed(robots, 'Googlebot-News', '/'), false);
});

test('comments and stray whitespace are ignored', () => {
  const robots = parseRobots(
    '# store rules\n  User-agent:  GPTBot   # the bot\n  Disallow:  /admin  \n'
  );

  assert.equal(isAllowed(robots, 'GPTBot', '/admin'), false);
  assert.equal(isAllowed(robots, 'GPTBot', '/'), true);
});

test('sitemaps are collected regardless of grouping', () => {
  const robots = parseRobots(
    'Sitemap: https://x.sa/sitemap.xml\nUser-agent: *\nDisallow:\nSitemap: https://x.sa/2.xml\n'
  );

  assert.deepEqual(robots.sitemaps, ['https://x.sa/sitemap.xml', 'https://x.sa/2.xml']);
});
