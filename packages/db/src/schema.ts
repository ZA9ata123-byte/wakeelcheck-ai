/**
 * مخطط قاعدة البيانات.
 *
 * يطابق القسم 04 من مواصفة البناء. الأعمدة الحاسمة موسومة بتعليق، لأن
 * تغييرها يغيّر عقداً أمنياً أو قانونياً لا مجرّد شكل بيانات.
 */

import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import type {
  Bilingual,
  BuyingQuestion,
  CompetitorMention,
  ScanKind,
  ScanStatus,
  Severity,
  StoreProfile,
} from '@wakeelcheck/core';

export const stores = pgTable('stores', {
  id: uuid('id').defaultRandom().primaryKey(),
  domain: text('domain').notNull().unique(),
  platform: text('platform'),
  /**
   * ★ العمود الذي يجيز الفحص الأمني العميق — القاعدة الملزمة رقم 07.
   * حين يكون null، الفحص السلبي فقط. لا يُكتب إلا بعد إثبات ملكية فعلي.
   */
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  /** salla_oauth | dns_txt | file | email */
  verifyMethod: text('verify_method'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const scans = pgTable(
  'scans',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    storeId: uuid('store_id').references(() => stores.id),
    kind: text('kind').$type<ScanKind>().notNull(),
    status: text('status').$type<ScanStatus>().notNull().default('queued'),
    profile: jsonb('profile').$type<StoreProfile | null>(),
    shareOfVoice: jsonb('share_of_voice'),
    /** التكلفة بالدولار × 1e6 — عدد صحيح، بلا أخطاء الفاصلة العائمة. */
    costMicros: bigint('cost_micros', { mode: 'number' }).default(0).notNull(),
    /** ★ تجزئة العنوان لا العنوان: بيانات شخصية بلا داعٍ لحفظها خاماً. */
    ipHash: text('ip_hash'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('scans_created_idx').on(table.createdAt),
    index('scans_ip_idx').on(table.ipHash, table.createdAt),
  ]
);

export const questions = pgTable('questions', {
  id: uuid('id').defaultRandom().primaryKey(),
  scanId: uuid('scan_id')
    .references(() => scans.id, { onDelete: 'cascade' })
    .notNull(),
  text: text('text_ar').notNull(),
  intent: text('intent').$type<BuyingQuestion['intent']>(),
  locale: text('locale'),
});

/** ★ هنا يعيش المنتج: الإجابة الحرفية ومن ذُكر فيها. */
export const engineAnswers = pgTable(
  'engine_answers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scanId: uuid('scan_id')
      .references(() => scans.id, { onDelete: 'cascade' })
      .notNull(),
    questionId: uuid('question_id').references(() => questions.id, { onDelete: 'cascade' }),
    engine: text('engine').notNull(),
    /** ★ حرفياً كما خرج من المحرك — القاعدة الملزمة رقم 05. لا تنظيف. */
    answerText: text('answer_text').notNull(),
    citedUrls: text('cited_urls').array(),
    storeMentioned: boolean('store_mentioned').notNull(),
    competitors: jsonb('competitors').$type<CompetitorMention[]>().notNull(),
    costMicros: bigint('cost_micros', { mode: 'number' }).default(0).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('answers_scan_idx').on(table.scanId)]
);

export const securityFindings = pgTable('security_findings', {
  id: uuid('id').defaultRandom().primaryKey(),
  scanId: uuid('scan_id')
    .references(() => scans.id, { onDelete: 'cascade' })
    .notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').$type<Severity>().notNull(),
  title: jsonb('title').$type<Bilingual>(),
  detail: jsonb('detail').$type<Bilingual>(),
  /**
   * ★ مطموس دائماً — القاعدة الملزمة رقم 01.
   * تخزين مفاتيح دفع حقيقية لمئات المتاجر يحوّل هذا الجدول إلى أثمن
   * هدف اختراق في السوق. القيمة الكاملة لا تصل إلى هنا أبداً.
   */
  evidenceRedacted: text('evidence_redacted').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

export const ruleResults = pgTable(
  'rule_results',
  {
    scanId: uuid('scan_id')
      .references(() => scans.id, { onDelete: 'cascade' })
      .notNull(),
    key: text('key').notNull(),
    passed: boolean('passed').notNull(),
    weight: integer('weight').notNull(),
    detail: jsonb('detail').$type<Bilingual>(),
    evidence: text('evidence'),
    fixSnippet: text('fix_snippet'),
  },
  (table) => [primaryKey({ columns: [table.scanId, table.key] })]
);

export const leads = pgTable('leads', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: text('email').notNull(),
  scanId: uuid('scan_id').references(() => scans.id),
  locale: text('locale'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
