import type { NextConfig } from 'next';

const config: NextConfig = {
  // الحزم مصادر TypeScript مباشرةً — لا خطوة بناء وسيطة.
  transpilePackages: [
    '@wakeelcheck/core',
    '@wakeelcheck/fetcher',
    '@wakeelcheck/limits',
    '@wakeelcheck/llm',
    '@wakeelcheck/pipeline',
    '@wakeelcheck/readiness',
    '@wakeelcheck/security',
    '@wakeelcheck/visibility',
  ],
};

export default config;
