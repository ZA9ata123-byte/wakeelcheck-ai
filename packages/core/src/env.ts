/**
 * قراءة متغيّرات البيئة بأنواع صريحة.
 *
 * لا شيء يُقرأ عند الاستيراد: التحقق يحدث عند استدعاء `readEnv()` فقط،
 * حتى تعمل الاختبارات بلا بيئة كاملة.
 */

export interface Env {
  // النماذج
  openrouterApiKey: string | null;
  deepseekApiKey: string | null;
  llmPrimary: 'oxalpha' | 'deepseek';

  // محرّكات الإجابة
  openaiApiKey: string | null;
  dataforseoLogin: string | null;
  dataforseoPassword: string | null;

  // البنية
  databaseUrl: string | null;
  redisUrl: string | null;
  turnstileSecret: string | null;
  ipHashSalt: string;

  // حدود التكلفة — ليست اختيارية، وهي ما يمنع حملة ترويج من حرق الميزانية
  freeScansPerIpPerDay: number;
  cacheTtlHours: number;
  maxMonthlySpendUsd: number;
}

function str(name: string): string | null {
  const raw = process.env[name];
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

function int(name: string, fallback: number): number {
  const raw = str(name);
  if (raw === null) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  }
  return parsed;
}

export function readEnv(): Env {
  const primary = str('LLM_PRIMARY') ?? 'oxalpha';
  if (primary !== 'oxalpha' && primary !== 'deepseek') {
    throw new Error(`LLM_PRIMARY must be "oxalpha" or "deepseek", got "${primary}"`);
  }

  return {
    openrouterApiKey: str('OPENROUTER_API_KEY'),
    deepseekApiKey: str('DEEPSEEK_API_KEY'),
    llmPrimary: primary,

    openaiApiKey: str('OPENAI_API_KEY'),
    dataforseoLogin: str('DATAFORSEO_LOGIN'),
    dataforseoPassword: str('DATAFORSEO_PASSWORD'),

    databaseUrl: str('DATABASE_URL'),
    redisUrl: str('REDIS_URL'),
    turnstileSecret: str('TURNSTILE_SECRET'),
    ipHashSalt: str('IP_HASH_SALT') ?? 'dev-only-salt-change-me',

    freeScansPerIpPerDay: int('FREE_SCANS_PER_IP_PER_DAY', 3),
    cacheTtlHours: int('CACHE_TTL_HOURS', 24),
    maxMonthlySpendUsd: int('MAX_MONTHLY_SPEND_USD', 300),
  };
}

/**
 * يتحقق أن المفاتيح اللازمة لتشغيل فحص حقيقي موجودة.
 * استدعِه عند إقلاع العامل — لا عند الاستيراد.
 */
export function assertScanReady(env: Env): void {
  const missing: string[] = [];

  if (env.deepseekApiKey === null) missing.push('DEEPSEEK_API_KEY');
  if (env.databaseUrl === null) missing.push('DATABASE_URL');
  if (env.redisUrl === null) missing.push('REDIS_URL');

  if (missing.length > 0) {
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}
