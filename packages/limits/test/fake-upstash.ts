/**
 * خادم Upstash وهميّ — نفس البروتوكول، بلا شبكة.
 *
 * يطبّق ما يستعمله `redisStore` فقط: GET وSET (مع EX) وINCRBY وTTL وEXPIRE
 * وDEL. وكلّ أمرٍ غيرها يُرفض كما يرفضه Redis، فلا يمرّ أمرٌ لم نختبره.
 */

interface Entry {
  value: string;
  expiresAt: number | null;
}

export interface FakeUpstash {
  fetch: typeof fetch;
  /** كم أمراً وصل — لقياس كلفة العمليات. */
  commands: string[][];
  /** يجعل الخادم يسقط — لاختبار فشل المخزن. */
  fail(mode: 'network' | 'http500' | 'redis-error' | null): void;
}

export const FAKE_URL = 'https://fake-upstash.test';
export const FAKE_TOKEN = 'test-token';

export function fakeUpstash(now: () => number = Date.now): FakeUpstash {
  const map = new Map<string, Entry>();
  const commands: string[][] = [];
  let failure: 'network' | 'http500' | 'redis-error' | null = null;

  const live = (key: string): Entry | null => {
    const e = map.get(key);
    if (e === undefined) return null;
    if (e.expiresAt !== null && now() >= e.expiresAt) {
      map.delete(key);
      return null;
    }
    return e;
  };

  const reply = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const run = (cmd: string[]): unknown => {
    const [name, key = '', ...args] = cmd;
    switch (name?.toUpperCase()) {
      case 'GET':
        return live(key)?.value ?? null;
      case 'SET': {
        const ex = args[1]?.toUpperCase() === 'EX' ? Number(args[2]) : null;
        map.set(key, { value: args[0] ?? '', expiresAt: ex === null ? null : now() + ex * 1000 });
        return 'OK';
      }
      case 'INCRBY': {
        const e = live(key);
        const current = e === null ? 0 : Number(e.value);
        if (!Number.isInteger(current)) throw new Error('ERR value is not an integer');
        const next = current + Number(args[0]);
        map.set(key, { value: String(next), expiresAt: e?.expiresAt ?? null });
        return next;
      }
      case 'TTL': {
        const e = live(key);
        if (e === null) return -2;
        if (e.expiresAt === null) return -1;
        return Math.ceil((e.expiresAt - now()) / 1000);
      }
      case 'EXPIRE': {
        const e = live(key);
        if (e === null) return 0;
        e.expiresAt = now() + Number(args[0]) * 1000;
        return 1;
      }
      case 'DEL':
        return map.delete(key) ? 1 : 0;
      default:
        throw new Error(`ERR unknown command '${name}'`);
    }
  };

  const handler = async (input: unknown, init?: RequestInit): Promise<Response> => {
    if (failure === 'network') throw new TypeError('fetch failed');
    if (failure === 'http500') return reply({ error: 'internal' }, 500);

    if (String(input) !== FAKE_URL) return reply({ error: 'wrong endpoint' }, 404);
    const auth = new Headers(init?.headers).get('authorization');
    if (auth !== `Bearer ${FAKE_TOKEN}`) return reply({ error: 'Unauthorized' }, 401);

    const cmd = JSON.parse(String(init?.body)) as string[];
    if (!cmd.every((part) => typeof part === 'string')) {
      return reply({ error: 'ERR arguments must be strings' }, 400);
    }
    commands.push(cmd);

    if (failure === 'redis-error') return reply({ error: 'ERR max requests limit exceeded' }, 400);

    try {
      return reply({ result: run(cmd) });
    } catch (err) {
      return reply({ error: err instanceof Error ? err.message : 'ERR' }, 400);
    }
  };

  return {
    fetch: handler as typeof fetch,
    commands,
    fail: (mode) => {
      failure = mode;
    },
  };
}
