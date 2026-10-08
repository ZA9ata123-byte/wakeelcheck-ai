/**
 * عميل SQL — واجهةٌ من دالّة واحدة.
 *
 * Neon في الإنتاج عبر HTTP: لا اتصال TCP يُفتح ويُدار في دالةٍ تعيش ثوانٍ،
 * كـUpstash تماماً. وPGlite في الاختبار: Postgres حقيقيّ داخل العملية، فالـSQL
 * المُختبَر هو نفسه الذي يجري في الإنتاج — لا محاكاة له.
 */

import { neon } from '@neondatabase/serverless';

export interface SqlClient {
  /** نصّ بعناصر `$1` و`$2`… ومعاملاتٌ منفصلة — لا دمج نصوص، فلا حقن. */
  query<T>(text: string, params?: readonly unknown[]): Promise<T[]>;
}

export function neonClient(connectionString: string): SqlClient {
  const sql = neon(connectionString);
  return {
    async query<T>(text: string, params: readonly unknown[] = []): Promise<T[]> {
      return (await sql.query(text, [...params])) as T[];
    },
  };
}
