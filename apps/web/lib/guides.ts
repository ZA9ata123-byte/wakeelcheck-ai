/**
 * الأدلة — محتوى يجيب عن أسئلة التاجر، بالعربية أولاً ثم الإنجليزية.
 *
 * كلّ دليل: الجواب في أوّل فقرة (المحرّكات تقتبس فقرات لا صفحات)، ثم الخطوات،
 * ثم المصادر الرسمية. لا رقم بلا مصدر، ولا وعد بالظهور — القاعدة 06.
 *
 * يُضاف دليلٌ بإضافة عنصرٍ هنا: الصفحة والخريطة والبيانات المنظّمة تتبعه.
 */

export type GuideBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'ul' | 'ol'; items: readonly string[] }
  | { kind: 'code'; text: string }
  | { kind: 'note'; text: string };

export interface GuideBody {
  title: string;
  description: string;
  /** الجواب المختصر — أوّل ما يُقرأ، وما يُقتبس. */
  answer: string;
  blocks: readonly GuideBlock[];
}

export interface Guide {
  slug: string;
  published: string;
  updated: string;
  ar: GuideBody;
  en: GuideBody;
  sources: readonly { label: string; url: string }[];
}

const OPENAI_BOTS = { label: 'OpenAI — Overview of OpenAI crawlers', url: 'https://platform.openai.com/docs/bots' };
const ANTHROPIC_BOTS = {
  label: 'Anthropic — Does Anthropic crawl data from the web?',
  url: 'https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler',
};
const GOOGLE_CRAWLERS = {
  label: 'Google Search Central — Google’s common crawlers (incl. Google-Extended)',
  url: 'https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers',
};
const OPENAI_SHOPPING = {
  label: 'OpenAI Help — Improving the visibility of your store in ChatGPT shopping',
  url: 'https://help.openai.com/en/articles/11128490-improving-the-visibility-of-your-store-in-chatgpt-shopping',
};
const SCHEMA_PRODUCT = { label: 'Schema.org — Product', url: 'https://schema.org/Product' };

export const GUIDES: readonly Guide[] = [
  {
    slug: 'appear-in-chatgpt',
    published: '2026-11-11',
    updated: '2026-11-11',
    sources: [OPENAI_BOTS, OPENAI_SHOPPING, ANTHROPIC_BOTS, GOOGLE_CRAWLERS, SCHEMA_PRODUCT],
    ar: {
      title: 'كيف يظهر متجرك في إجابات ChatGPT؟ الدليل العملي للمتاجر العربية',
      description:
        'الخطوات التي تجعل ChatGPT قادراً على قراءة متجرك وذكره: السماح لـOAI-SearchBot، وصفحات تُقرأ بلا JavaScript، وبيانات منتج منظّمة، وحضورٌ في الصفحات التي يعتمد عليها.',
      answer:
        'يظهر متجرك في ChatGPT حين يستطيع زاحف البحث OAI-SearchBot قراءته، وحين تكون صفحات منتجاته واضحةً للآلة (اسم وسعر وتوفّر في بيانات منظّمة)، وحين تذكرك صفحاتٌ أخرى يعتمد عليها ChatGPT في جوابه. لا توجد طريقة مدفوعة للظهور، ولا ضمان؛ لكن هذه الشروط إن غابت فلن يذكرك أبداً.',
      blocks: [
        { kind: 'h2', text: '1. اسمح للزاحف الصحيح: OAI-SearchBot لا GPTBot' },
        {
          kind: 'p',
          text: 'لدى OpenAI زاحفان مختلفان: OAI-SearchBot يقرأ المواقع ليظهرها في بحث ChatGPT، وGPTBot يجمع محتوى لتدريب النماذج. منعُ GPTBot لا يُخفيك من البحث، أمّا منعُ OAI-SearchBot فيُخفيك. افتح ملف robots.txt في متجرك وتأكّد أن OAI-SearchBot غير محظور:',
        },
        { kind: 'code', text: 'User-agent: OAI-SearchBot\nAllow: /' },
        {
          kind: 'note',
          text: 'اقرأ الملف المنشور فعلاً — اكتب في المتصفح yourstore.com/robots.txt بنطاق متجرك — لا الملف في إعداداتك: خدمات مثل Cloudflare قد تضيف قواعد تحظر زواحف الذكاء الاصطناعي بزرّ واحد.',
        },
        { kind: 'h2', text: '2. اجعل صفحاتك تُقرأ بلا JavaScript' },
        {
          kind: 'p',
          text: 'بعض الزواحف لا تشغّل JavaScript. إن كان اسم المنتج وسعره ووصفه لا يظهرون في HTML الخام للصفحة، فالزاحف يرى صفحة فارغة. افتح «عرض المصدر» في المتصفّح وابحث عن اسم منتجك؛ إن لم تجده، فالمشكلة هنا.',
        },
        { kind: 'h2', text: '3. بيانات المنتج المنظّمة' },
        {
          kind: 'p',
          text: 'أضف إلى كلّ صفحة منتج بيانات Product وOffer بصيغة Schema.org: الاسم، والعلامة، والسعر، والعملة، والتوفّر. وتأكّد أن السعر في البيانات المنظّمة هو نفسه الظاهر في الصفحة — التناقض يجعل الآلة لا تثق بأيٍّ منهما.',
        },
        {
          kind: 'ul',
          items: [
            'المنصّات مثل Shopify وسلة وزد تضيف جزءاً من هذه البيانات تلقائياً؛ تحقّق ممّا ينقص.',
            'لا تضف تقييماتٍ (AggregateRating) إلا إن كانت مراجعات حقيقية.',
          ],
        },
        { kind: 'h2', text: '4. ChatGPT Shopping' },
        {
          kind: 'p',
          text: 'لدى ChatGPT تجربة تسوّق تعرض المنتجات والمتاجر. تشرح OpenAI في صفحة المساعدة كيف تُحسَّن رؤية المتجر فيها، وأنّ منتجات Shopify تصلها عبر كتالوج Shopify، بينما تعتمد المتاجر الأخرى على الزحف أو على ملفّ منتجات. راجع الصفحة الرسمية في المصادر أدناه، فالتفاصيل تتغيّر.',
        },
        { kind: 'h2', text: '5. كن حاضراً حيث يقرأ ChatGPT' },
        {
          kind: 'p',
          text: 'حين يجيب ChatGPT عن «أفضل متجر عطور في الكويت» يستند غالباً إلى صفحات أخرى: قوائم «أفضل المتاجر»، ومقالات، ومنتديات. في تقريرنا نعرض هذه المصادر بالاسم لكلّ إجابة، لأن الظهور فيها طريقٌ للظهور في الجواب.',
        },
        { kind: 'h2', text: '6. قِس، ثم قِس مجدداً' },
        {
          kind: 'p',
          text: 'الإجابات تتغيّر من يوم لآخر. اسأل ChatGPT أسئلة زبونك الحقيقية، وسجّل من ذُكر ومن غاب، وكرّر ذلك أسبوعياً. إجابة واحدة لا تثبت شيئاً؛ الاتجاه عبر الأسابيع هو المؤشّر.',
        },
        {
          kind: 'note',
          text: 'وكيل تشيك يفعل هذا كلّه: يسأل ChatGPT وGoogle AI Mode أسئلة زبونك، ويعرض الإجابة حرفياً، ومن ذُكر بدلاً منك، ويفحص robots.txt والبيانات المنظّمة، ويعطيك الإصلاح. الفحص الأول مجاني.',
        },
      ],
    },
    en: {
      title: 'How to get your store into ChatGPT answers: a practical guide',
      description:
        'What makes ChatGPT able to read and name your store: allowing OAI-SearchBot, pages readable without JavaScript, structured product data, and presence on the pages it relies on.',
      answer:
        'Your store can appear in ChatGPT when its search crawler, OAI-SearchBot, can read it, when your product pages are clear to machines (name, price and availability in structured data), and when other pages ChatGPT relies on mention you. There is no paid route and no guarantee — but without these conditions, it will never name you.',
      blocks: [
        { kind: 'h2', text: '1. Allow the right crawler: OAI-SearchBot, not GPTBot' },
        {
          kind: 'p',
          text: 'OpenAI runs two different crawlers: OAI-SearchBot reads sites to surface them in ChatGPT search, and GPTBot collects content for model training. Blocking GPTBot does not hide you from search; blocking OAI-SearchBot does. Open your robots.txt and make sure OAI-SearchBot is not blocked:',
        },
        { kind: 'code', text: 'User-agent: OAI-SearchBot\nAllow: /' },
        {
          kind: 'note',
          text: 'Read the live file at https://yourstore/robots.txt, not the one in your settings: services such as Cloudflare can add rules that block AI crawlers with a single toggle.',
        },
        { kind: 'h2', text: '2. Make pages readable without JavaScript' },
        {
          kind: 'p',
          text: 'Some crawlers do not run JavaScript. If your product name, price and description are not in the page’s raw HTML, the crawler sees an empty page. Open “view source” and search for your product name; if it is missing, that is the problem.',
        },
        { kind: 'h2', text: '3. Structured product data' },
        {
          kind: 'p',
          text: 'Add Schema.org Product and Offer data to every product page: name, brand, price, currency and availability. Make sure the structured price matches the visible one — a mismatch makes machines trust neither.',
        },
        {
          kind: 'ul',
          items: [
            'Platforms like Shopify, Salla and Zid add part of this automatically; check what is missing.',
            'Do not add ratings (AggregateRating) unless they come from real reviews.',
          ],
        },
        { kind: 'h2', text: '4. ChatGPT shopping' },
        {
          kind: 'p',
          text: 'ChatGPT has a shopping experience that shows products and stores. OpenAI’s help page explains how to improve a store’s visibility there, and that Shopify products reach it through the Shopify Catalog while other stores rely on crawling or a product feed. Check the official page in the sources below — the details change.',
        },
        { kind: 'h2', text: '5. Be present where ChatGPT reads' },
        {
          kind: 'p',
          text: 'When ChatGPT answers “best perfume store in Kuwait”, it often relies on other pages: “best of” lists, articles, forums. Our report names these sources for every answer, because being on them is a route into the answer.',
        },
        { kind: 'h2', text: '6. Measure, then measure again' },
        {
          kind: 'p',
          text: 'Answers change from day to day. Ask ChatGPT your customers’ real questions, log who was named and who was not, and repeat weekly. One answer proves nothing; the trend across weeks is the signal.',
        },
        {
          kind: 'note',
          text: 'WakeelCheck does all of this: it asks ChatGPT and Google AI Mode your customers’ questions, shows the answer verbatim and who was named instead of you, checks robots.txt and structured data, and gives you the fix. The first scan is free.',
        },
      ],
    },
  },
  {
    slug: 'ai-crawlers-search-vs-training',
    published: '2026-11-11',
    updated: '2026-11-11',
    sources: [OPENAI_BOTS, ANTHROPIC_BOTS, GOOGLE_CRAWLERS],
    ar: {
      title: 'OAI-SearchBot أم GPTBot؟ أيّ زواحف الذكاء الاصطناعي تقرّر ظهور متجرك',
      description:
        'الفرق بين زواحف البحث المباشر وزواحف التدريب عند OpenAI وAnthropic وGoogle، وما الذي تمنعه أو تسمح به في robots.txt دون أن تختفي من الإجابات.',
      answer:
        'زواحف البحث المباشر هي التي تقرّر ظهورك في الإجابات: OAI-SearchBot عند ChatGPT، وClaude-SearchBot عند Claude، وGooglebot عند Google (ومنه AI Overviews وAI Mode)، وBingbot عند Copilot. أمّا GPTBot وClaudeBot وGoogle-Extended فللتدريب؛ منعها يمنع استعمال محتواك في التدريب، ولا يُخفيك من البحث.',
      blocks: [
        { kind: 'h2', text: 'الجدول المختصر' },
        {
          kind: 'ul',
          items: [
            'OpenAI — OAI-SearchBot: البحث في ChatGPT · GPTBot: التدريب · ChatGPT-User: صفحات يفتحها ChatGPT بطلب مستخدم.',
            'Anthropic — Claude-SearchBot: البحث في Claude · ClaudeBot: التدريب · Claude-User: صفحات يفتحها Claude بطلب مستخدم.',
            'Google — Googlebot: البحث وإجاباته الذكية · Google-Extended: يتحكّم في استعمال المحتوى لنماذج Gemini، ولا يؤثّر في الظهور في بحث Google.',
            'Microsoft — Bingbot: بحث Bing، وعليه يعتمد Copilot.',
          ],
        },
        { kind: 'h2', text: 'الخطأ الشائع' },
        {
          kind: 'p',
          text: 'كثير من المتاجر، وبعض الأدوات، تعدّ GPTBot «زاحف ChatGPT» وتحكم على الظهور به. لكن توثيق OpenAI يفصل بينهما: OAI-SearchBot للبحث، وGPTBot للتدريب. فمتجرٌ يمنع GPTBot وحده لم يختفِ من بحث ChatGPT، ومتجرٌ يسمح لـGPTBot ويمنع OAI-SearchBot اختفى منه.',
        },
        { kind: 'h2', text: 'إعداد robots.txt المقترح لمتجر يريد الظهور' },
        {
          kind: 'code',
          text: 'User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: Claude-SearchBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Googlebot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /',
        },
        {
          kind: 'p',
          text: 'أمّا زواحف التدريب فقرارك: السماح لها لا يضرّ الظهور، ومنعها لا يُخفيك. لا تمنع صفحات المنتجات أو التصنيفات عن زواحف البحث، واحصر المنع في صفحات مثل السلّة والحساب والدفع.',
        },
        { kind: 'h2', text: 'كيف تتأكّد' },
        {
          kind: 'ol',
          items: [
            'افتح yourstore.com/robots.txt (بنطاق متجرك) كما هو منشور، لا كما في الإعدادات.',
            'ابحث عن مجموعة User-agent: * وعن أيّ مجموعة باسم زاحف بحث، وتأكّد أن Disallow: / غير موجود فيها.',
            'إن كنت تستعمل Cloudflare، تأكّد أن خيارات حظر بوتات الذكاء الاصطناعي لا تشمل زواحف البحث.',
          ],
        },
        {
          kind: 'note',
          text: 'وكيل تشيك يقرأ robots.txt بالمجموعات وفق المعيار RFC 9309، ويفصل في تقريره بين زواحف البحث المباشر وزواحف التدريب، فلا يُقال لك إنك محجوب عن ChatGPT وأنت لم تمنع إلا التدريب.',
        },
      ],
    },
    en: {
      title: 'OAI-SearchBot or GPTBot? Which AI crawlers decide whether your store appears',
      description:
        'The difference between live-search and training crawlers at OpenAI, Anthropic and Google, and what you can block in robots.txt without disappearing from AI answers.',
      answer:
        'Live-search crawlers decide whether you appear in answers: OAI-SearchBot for ChatGPT, Claude-SearchBot for Claude, Googlebot for Google (including AI Overviews and AI Mode), and Bingbot for Copilot. GPTBot, ClaudeBot and Google-Extended are about training: blocking them stops your content being used for training, and does not hide you from search.',
      blocks: [
        { kind: 'h2', text: 'The short table' },
        {
          kind: 'ul',
          items: [
            'OpenAI — OAI-SearchBot: ChatGPT search · GPTBot: training · ChatGPT-User: pages ChatGPT opens at a user’s request.',
            'Anthropic — Claude-SearchBot: Claude search · ClaudeBot: training · Claude-User: pages Claude opens at a user’s request.',
            'Google — Googlebot: Search and its AI answers · Google-Extended: controls use of content for Gemini models, and does not affect appearing in Google Search.',
            'Microsoft — Bingbot: Bing search, which Copilot relies on.',
          ],
        },
        { kind: 'h2', text: 'The common mistake' },
        {
          kind: 'p',
          text: 'Many stores, and some tools, treat GPTBot as “the ChatGPT crawler” and judge visibility by it. OpenAI’s documentation separates them: OAI-SearchBot for search, GPTBot for training. A store that blocks only GPTBot has not disappeared from ChatGPT search; a store that allows GPTBot but blocks OAI-SearchBot has.',
        },
        { kind: 'h2', text: 'A suggested robots.txt for a store that wants to appear' },
        {
          kind: 'code',
          text: 'User-agent: OAI-SearchBot\nAllow: /\n\nUser-agent: Claude-SearchBot\nAllow: /\n\nUser-agent: PerplexityBot\nAllow: /\n\nUser-agent: Googlebot\nAllow: /\n\nUser-agent: Bingbot\nAllow: /',
        },
        {
          kind: 'p',
          text: 'Training crawlers are your call: allowing them does not hurt visibility, and blocking them does not hide you. Never block product or category pages from search crawlers; limit blocks to pages like cart, account and checkout.',
        },
        { kind: 'h2', text: 'How to check' },
        {
          kind: 'ol',
          items: [
            'Open https://yourstore/robots.txt as it is published, not as it appears in your settings.',
            'Find the User-agent: * group and any group naming a search crawler, and make sure Disallow: / is not in it.',
            'If you use Cloudflare, make sure its AI-bot blocking options do not include search crawlers.',
          ],
        },
        {
          kind: 'note',
          text: 'WakeelCheck parses robots.txt by groups following RFC 9309, and separates live-search crawlers from training crawlers in its report — so you are never told you are blocked from ChatGPT when you only blocked training.',
        },
      ],
    },
  },
];

export const guideBySlug = (slug: string): Guide | undefined => GUIDES.find((g) => g.slug === slug);

export const guidePath = (slug: string, lang: 'ar' | 'en'): string =>
  lang === 'ar' ? `/guides/${slug}` : `/en/guides/${slug}`;
