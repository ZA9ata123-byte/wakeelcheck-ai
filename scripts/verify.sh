#!/usr/bin/env bash
# نفس خطوات .github/workflows/ci.yml، تُشغَّل محلياً قبل كلّ push.
#
# لماذا: CI على GitHub متوقّف منذ 1 نوفمبر 2026 بسبب قفل الفوترة على الحساب
# (الوظيفة لا تبدأ أصلاً). قرار الرئيس: لا إنفاق قبل أوّل عشرة عملاء. فيبقى
# العقد نفسه — الاختبارات والأنواع والبناء وحارس الأسرار — هنا حتى يعود.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ Tests";            pnpm -s test 2>&1 | grep -E "^# (pass|fail)"
pnpm -s test >/dev/null 2>&1 || { echo "✗ tests failed"; exit 1; }
echo "▸ Typecheck";        pnpm -s typecheck
echo "▸ Typecheck (web)";  pnpm -s --filter @wakeelcheck/web typecheck
echo "▸ Build";            pnpm -s --filter @wakeelcheck/web build >/dev/null
echo "▸ No secret-shaped strings"
if grep -rInE 'sk_live_[0-9a-zA-Z]{16,}|AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}' \
     --include='*.ts' --include='*.tsx' --include='*.js' \
     --exclude-dir=node_modules --exclude-dir=.next . ; then
  echo "✗ A secret-shaped literal was found. Build test values at runtime instead."
  exit 1
fi
echo "✓ verify: all green"
