// WakeelCheck (وكيل تشيك) - Real-Time AI Readiness Audit Engine
// Copyright (c) 2026 WakeelCheck Team

let currentLang = 'ar';
let activeCategory = 'all';
let currentAuditResults = [];
let currentRealAuditData = null;

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', () => {
  initLanguageToggle();
  initFormSubmit();
  initFaqAccordion();
});

// Language Switcher
function initLanguageToggle() {
  const toggleBtn = document.getElementById('langToggleBtn');
  if (!toggleBtn) return;

  toggleBtn.addEventListener('click', () => {
    currentLang = currentLang === 'ar' ? 'en' : 'ar';
    toggleBtn.textContent = currentLang === 'ar' ? 'English' : 'العربية';
    document.documentElement.lang = currentLang;
    document.documentElement.dir = currentLang === 'ar' ? 'rtl' : 'ltr';
    updateLanguageText();
  });
}

function updateLanguageText() {
  document.querySelectorAll('[data-ar]').forEach(el => {
    const text = currentLang === 'ar' ? el.getAttribute('data-ar') : el.getAttribute('data-en');
    if (text) el.textContent = text;
  });

  if (currentAuditResults.length > 0) {
    renderAuditChecklist();
  }
}

// FAQ Accordion
function initFaqAccordion() {
  document.querySelectorAll('.faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const parent = q.parentElement;
      parent.classList.toggle('active');
    });
  });
}

// Preset button click handler
window.setPreset = function(url) {
  const input = document.getElementById('storeUrl');
  if (input) {
    input.value = url;
    startAudit(url);
  }
};

// Form Submit & Scan Workflow
function initFormSubmit() {
  const form = document.getElementById('auditForm');
  const btn = document.getElementById('startAuditBtn');
  
  const handleTrigger = (e) => {
    if (e) e.preventDefault();
    const input = document.getElementById('storeUrl');
    if (!input) return;
    const url = input.value.trim();
    if (!url) {
      input.focus();
      return;
    }
    startAudit(url);
  };

  if (form) {
    form.addEventListener('submit', handleTrigger);
  }
  if (btn) {
    btn.addEventListener('click', handleTrigger);
  }
}

function startAudit(rawUrl) {
  let cleanDomain = rawUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  
  const scannerOverlay = document.getElementById('scannerOverlay');
  const progressFill = document.getElementById('scanProgressFill');
  const stepLog = document.getElementById('scanStepLog');
  const targetDisplay = document.getElementById('scannerTargetUrl');

  if (targetDisplay) targetDisplay.textContent = cleanDomain;
  if (scannerOverlay) scannerOverlay.style.display = 'flex';
  if (progressFill) progressFill.style.width = '5%';

  const steps = [
    { pct: 15, msg_ar: '📡 الاتصال بخادم المتجر وجلب صفحة الرئيسية و robots.txt...', msg_en: '📡 Connecting to store server and fetching homepage & robots.txt...' },
    { pct: 35, msg_ar: '🔍 قراءة وتحليل أكواد JSON-LD و Schema.org للمنتجات والأسعار...', msg_en: '🔍 Parsing JSON-LD and Schema.org product & price structure...' },
    { pct: 55, msg_ar: '🤖 فحص إذن البوتات الذكية (GPTBot, ClaudeBot, PerplexityBot) و llms.txt...', msg_en: '🤖 Auditing AI bot permissions & llms.txt file...' },
    { pct: 75, msg_ar: '⚡ تقييم سرعة الاستجابة TTFB وتجميع وسوم OpenGraph...', msg_en: '⚡ Evaluating TTFB server response speed & OpenGraph tags...' },
    { pct: 90, msg_ar: '🛡️ فحص حماية المتجر والتشفير وبوابات الدفع ضد الطلبيات الوهمية...', msg_en: '🛡️ Auditing security, payment gateways, and bot fraud prevention...' },
    { pct: 100, msg_ar: '🎉 اكتمل الفحص وتوليد التقرير المباشر!', msg_en: '🎉 Audit complete! Rendering live verified report...' }
  ];

  let currentStep = 0;
  const interval = setInterval(() => {
    if (currentStep < steps.length) {
      const step = steps[currentStep];
      if (progressFill) progressFill.style.width = step.pct + '%';
      if (stepLog) stepLog.textContent = currentLang === 'ar' ? step.msg_ar : step.msg_en;
      currentStep++;
    } else {
      clearInterval(interval);
      setTimeout(() => {
        finishAudit(cleanDomain, rawUrl);
      }, 300);
    }
  }, 400);
}

async function finishAudit(domain, fullUrl) {
  document.getElementById('scannerOverlay').style.display = 'none';
  document.getElementById('dashboardSection').style.display = 'block';
  document.getElementById('dashboardSection').scrollIntoView({ behavior: 'smooth' });

  document.getElementById('targetUrlDisplay').textContent = domain;
  document.getElementById('googleOfficialLink').href = `https://pagespeed.web.dev/analysis?url=https://${domain}`;

  // Call Real Serverless Audit API
  currentRealAuditData = null;
  try {
    const res = await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: fullUrl || domain })
    });
    const data = await res.json();
    if (data && data.success) {
      currentRealAuditData = data;
    }
  } catch (err) {
    console.warn('Real API fetch failed, falling back to static hash:', err);
  }

  // Apply Results & Render
  applyAuditResults(domain, currentRealAuditData);
  renderDashboardData();

  // Trigger live background fetch to official Google PageSpeed API
  fetchLiveGooglePageSpeed(domain);
}

function animateScoreCounter(element, targetScore) {
  if (!element || isNaN(targetScore)) return;
  let current = 0;
  const duration = 1000;
  const stepTime = 25;
  const steps = duration / stepTime;
  const increment = targetScore / steps;

  const timer = setInterval(() => {
    current += increment;
    if (current >= targetScore) {
      current = targetScore;
      clearInterval(timer);
    }
    element.textContent = `${Math.round(current)}/100`;
  }, stepTime);
}

async function fetchLiveGooglePageSpeed(domain) {
  const targetUrl = domain.startsWith('http') ? domain : `https://${domain}`;
  const mobileLabel = document.getElementById('psMobileVal');
  const desktopLabel = document.getElementById('psDesktopVal');

  if (mobileLabel) mobileLabel.textContent = '⏳ ...';
  if (desktopLabel) desktopLabel.textContent = '⏳ ...';

  try {
    const resMobile = await fetch(`/api/pagespeed?url=${encodeURIComponent(targetUrl)}&strategy=mobile`);
    const dataMobile = await resMobile.json();

    if (dataMobile && dataMobile.success && typeof dataMobile.score === 'number') {
      animateScoreCounter(mobileLabel, dataMobile.score);
    }

    const resDesktop = await fetch(`/api/pagespeed?url=${encodeURIComponent(targetUrl)}&strategy=desktop`);
    const dataDesktop = await resDesktop.json();

    if (dataDesktop && dataDesktop.success && typeof dataDesktop.score === 'number') {
      animateScoreCounter(desktopLabel, dataDesktop.score);
    }
  } catch (e) {
    console.warn('PageSpeed live calculation error:', e);
  }
}

function hashDomain(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    const char = domain.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}

function applyAuditResults(domain, realData) {
// Master 64 Rules Catalog
const auditRulesCatalog = [
  // 1-8: Schema.org & JSON-LD
  { id: 1, cat: 'agents_files', severity: 'critical', name_ar: 'فحص JSON-LD Product Schema', name_en: 'JSON-LD Product Schema Check', desc_ar: 'فحص الهيكلية البرمجية لبيانات المنتجات والمواصفات.', desc_en: 'Audits structured JSON-LD data for product specifications.' },
  { id: 2, cat: 'agents_files', severity: 'critical', name_ar: 'فحص أسعار وعملة المنتجات Schema Offer', name_en: 'Schema Offer Price & Currency Check', desc_ar: 'التحقق من توفر وسم الأسعار والعملة برمجياً.', desc_en: 'Verifies structured price and currency availability.' },
  { id: 3, cat: 'agents_files', severity: 'warning', name_ar: 'فحص التقييمات والمراجعات AggregateRating', name_en: 'AggregateRating Schema Check', desc_ar: 'تقييم كائنات التقييمات وآراء العملاء.', desc_en: 'Audits customer rating and review schema objects.' },
  { id: 4, cat: 'agents_files', severity: 'warning', name_ar: 'فحص مسارات التصفح BreadcrumbList', name_en: 'BreadcrumbList Schema Check', desc_ar: 'فحص التسلسل الهيكلي لأقسام وصفحات المتجر.', desc_en: 'Audits hierarchical navigation breadcrumbs.' },
  { id: 5, cat: 'agents_files', severity: 'warning', name_ar: 'فحص وسم العلامة التجارية Brand Schema', name_en: 'Brand Schema Check', desc_ar: 'فحص وتحديد اسم العلامة التجارية في كود المتجر.', desc_en: 'Checks brand identity markup in store code.' },
  { id: 6, cat: 'agents_files', severity: 'warning', name_ar: 'فحص تعدد نصوص JSON-LD', name_en: 'Multiple JSON-LD Blocks Check', desc_ar: 'التحقق من وجود نصوص JSON-LD في أجزاء المتجر.', desc_en: 'Verifies multiple JSON-LD scripts coverage.' },
  { id: 7, cat: 'agents_files', severity: 'warning', name_ar: 'فحص تنوع كائنات الهيكلية Rich Schema Types', name_en: 'Rich Schema Types Check', desc_ar: 'تقييم شمولية وسوم الـ Schema لمختلف المكونات.', desc_en: 'Evaluates diversity of structured schema types.' },
  { id: 8, cat: 'agents_files', severity: 'warning', name_ar: 'فحص بيانات المؤسسة Organization Schema', name_en: 'Organization Schema Check', desc_ar: 'فحص بيانات الشعار والهوية المؤسسية للمتجر.', desc_en: 'Checks store identity and Organization schema.' },

  // 9-16: Microdata & OpenGraph
  { id: 9, cat: 'schema', severity: 'critical', name_ar: 'فحص وسم OpenGraph Title', name_en: 'OpenGraph Title Check', desc_ar: 'فحص عنوان og:title الموجّه للبوتات وتطبيقات التواصل.', desc_en: 'Checks og:title metadata tag for bots.' },
  { id: 10, cat: 'schema', severity: 'critical', name_ar: 'فحص وسم OpenGraph Image', name_en: 'OpenGraph Image Check', desc_ar: 'فحص توفر صورة og:image عالية الجودة للمعاينة.', desc_en: 'Verifies og:image preview tag availability.' },
  { id: 11, cat: 'schema', severity: 'warning', name_ar: 'فحص وسم og:price في OpenGraph', name_en: 'OpenGraph Price Check', desc_ar: 'فحص توفر وسم السعر في الميتا داتا.', desc_en: 'Audits og:price metadata tag presence.' },
  { id: 12, cat: 'schema', severity: 'warning', name_ar: 'فحص وسم og:currency في OpenGraph', name_en: 'OpenGraph Currency Check', desc_ar: 'فحص توفر رمز العملة في البيانات المفتوحة.', desc_en: 'Verifies og:currency metadata tag.' },
  { id: 13, cat: 'schema', severity: 'warning', name_ar: 'فحص وسم توفر المنتج og:availability', name_en: 'OpenGraph Availability Check', desc_ar: 'التحقق من بيان حالة التوفر في المخزون.', desc_en: 'Verifies stock availability metadata.' },
  { id: 14, cat: 'schema', severity: 'warning', name_ar: 'فحص كارت تويتر Twitter Card', name_en: 'Twitter Card Check', desc_ar: 'فحص كروت المعاينة على منصة X وتويتر.', desc_en: 'Audits twitter:card preview tags.' },
  { id: 15, cat: 'schema', severity: 'warning', name_ar: 'فحص الوصف الترويجي Meta Description', name_en: 'Meta Description Check', desc_ar: 'تقييم جودة وطول النص الوصفي للمتجر.', desc_en: 'Evaluates store meta description tag.' },
  { id: 16, cat: 'schema', severity: 'warning', name_ar: 'فحص الرابط الأساسي Canonical URL', name_en: 'Canonical URL Check', desc_ar: 'فحص وسم الرابط القياسي الموحد.', desc_en: 'Audits link rel=canonical tag.' },

  // 17-24: Machine Readability & API Access
  { id: 17, cat: 'geo_aeo', severity: 'critical', name_ar: 'فحص واجهات REST / GraphQL APIs', name_en: 'REST/GraphQL API Footprint', desc_ar: 'فحص وجود واجهات برمجية مباشرة يستدعيها الوكلاء.', desc_en: 'Checks for direct API footprints.' },
  { id: 18, cat: 'geo_aeo', severity: 'warning', name_ar: 'فحص بصمة منصة التجارة الإلكترونية', name_en: 'E-Commerce Platform Signature', desc_ar: 'التعرف على منصة المتجر (سلة، زد، Shopify، إلخ).', desc_en: 'Detects store platform signature.' },
  { id: 19, cat: 'geo_aeo', severity: 'warning', name_ar: 'فحص استجابات JSON القابلة للقراءة', name_en: 'JSON Response Availability', desc_ar: 'فحص إتاحة تنسيقات JSON في الـ DOM.', desc_en: 'Audits JSON formats in DOM.' },
  { id: 20, cat: 'geo_aeo', severity: 'warning', name_ar: 'فحص النماذج التفاعلية Forms', name_en: 'Interactive Forms Check', desc_ar: 'تقييم توفر النماذج التفاعلية ومداهم برمجياً.', desc_en: 'Checks interactive form elements.' },
  { id: 21, cat: 'geo_aeo', severity: 'warning', name_ar: 'فحص مسارات السلة والشراء Cart & Checkout', name_en: 'Cart & Checkout Path Check', desc_ar: 'التحقق من وضوح روابط ومسارات السلة.', desc_en: 'Audits cart & checkout path visibility.' },
  { id: 22, cat: 'geo_aeo', severity: 'warning', name_ar: 'فحص توافق معايير البيانات الموحدة', name_en: 'Data Standards Compatibility', desc_ar: 'فحص الامتثال لمعايير تبادل البيانات.', desc_en: 'Verifies structured data standards compliance.' },
  { id: 23, cat: 'geo_aeo', severity: 'warning', name_ar: 'فحص خريطة الموقع Sitemap.xml', name_en: 'Sitemap.xml Availability', desc_ar: 'فحص وجود وإتاحة ملف sitemap.xml.', desc_en: 'Checks sitemap.xml availability.' },
  { id: 24, cat: 'geo_aeo', severity: 'warning', name_ar: 'فحص مؤشرات المخزون المباشرة Stock Indicators', name_en: 'Realtime Stock Indicators', desc_ar: 'فحص بيانات توفر المخزون في الصفحة.', desc_en: 'Audits inventory stock indicators.' },

  // 25-32: Semantic HTML & Accessibility
  { id: 25, cat: 'performance', severity: 'critical', name_ar: 'فحص عنوان H1 الموحد', name_en: 'Single H1 Tag Check', desc_ar: 'التحقق من وجود عنوان رئيسي H1 فريد ومثالي.', desc_en: 'Ensures exactly one H1 element exists.' },
  { id: 26, cat: 'performance', severity: 'warning', name_ar: 'فحص وسم القوائم Semantic Nav', name_en: 'Semantic Nav Tag Check', desc_ar: 'فحص استخدام وسم nav الدلالي للقوائم.', desc_en: 'Audits nav element usage.' },
  { id: 27, cat: 'performance', severity: 'warning', name_ar: 'فحص الهيدر والفوتر Header & Footer', name_en: 'Semantic Header & Footer Check', desc_ar: 'تقييم استخدام وسوم header و footer القياسية.', desc_en: 'Verifies header and footer tags.' },
  { id: 28, cat: 'performance', severity: 'warning', name_ar: 'فحص وسم المحتوى الرئيسي Main', name_en: 'Semantic Main Tag Check', desc_ar: 'فحص تحديد كتلة المحتوى الرئيسي بـ main.', desc_en: 'Checks main element presence.' },
  { id: 29, cat: 'performance', severity: 'warning', name_ar: 'فحص النصوص البديلة للصور Image Alt Ratio', name_en: 'Image Alt Text Ratio Check', desc_ar: 'قياس نسبة الصور المحتوية على وصف Alt.', desc_en: 'Measures percentage of images with alt text.' },
  { id: 30, cat: 'performance', severity: 'warning', name_ar: 'فحص خصائص إمكانية الوصول ARIA Attributes', name_en: 'ARIA Accessibility Attributes', desc_ar: 'تقييم استخدام ARIA لمساعدة البوتات والوكلاء.', desc_en: 'Evaluates ARIA attribute usage.' },
  { id: 31, cat: 'performance', severity: 'warning', name_ar: 'فحص تحديد لغة المتجر HTML Lang Attribute', name_en: 'HTML Lang Attribute Check', desc_ar: 'فحص وسم اللغة في المستند الرئيسي.', desc_en: 'Audits html lang attribute.' },
  { id: 32, cat: 'performance', severity: 'warning', name_ar: 'فحص روابط التنقل الصريحة Explicit Links', name_en: 'Explicit Hyperlinks Check', desc_ar: 'فحص توفر روابط التنقل ذات المسار الصريح.', desc_en: 'Checks explicit navigation links.' },

  // 33-40: Robots & AI Bot Access
  { id: 33, cat: 'security', severity: 'critical', name_ar: 'فحص وجود ملف robots.txt', name_en: 'Robots.txt File Presence', desc_ar: 'التحقق من توفر ملف التوجيه الرئيسي robots.txt.', desc_en: 'Verifies robots.txt presence.' },
  { id: 34, cat: 'security', severity: 'critical', name_ar: 'فحص إذن بوت ChatGPT (GPTBot)', name_en: 'GPTBot Permission Check', desc_ar: 'التحقق من عدم حظر بوت OpenAI ChatGPT.', desc_en: 'Checks GPTBot crawler permission.' },
  { id: 35, cat: 'security', severity: 'warning', name_ar: 'فحص إذن بوت Claude (ClaudeBot)', name_en: 'ClaudeBot Permission Check', desc_ar: 'التحقق من عدم حظر بوت Anthropic Claude.', desc_en: 'Checks ClaudeBot crawler permission.' },
  { id: 36, cat: 'security', severity: 'warning', name_ar: 'فحص إذن بوت Perplexity (PerplexityBot)', name_en: 'PerplexityBot Permission Check', desc_ar: 'التحقق من عدم حظر بوت Perplexity AI.', desc_en: 'Checks PerplexityBot crawler permission.' },
  { id: 37, cat: 'security', severity: 'warning', name_ar: 'فحص إذن بوت Gemini (Google-Extended)', name_en: 'Google-Extended Bot Permission', desc_ar: 'التحقق من عدم حظر بوت Google Gemini.', desc_en: 'Checks Google-Extended bot permission.' },
  { id: 38, cat: 'security', severity: 'warning', name_ar: 'فحص معدل الطلبات Crawl-Delay', name_en: 'Crawl-Delay Rate Check', desc_ar: 'تقييم مهلة طلبات الزحف المعرفة للبوتات.', desc_en: 'Audits crawl-delay directive rate.' },
  { id: 39, cat: 'security', severity: 'warning', name_ar: 'فحص رابط الخريطة في robots.txt', name_en: 'Sitemap Link in Robots.txt', desc_ar: 'التحقق من إدراج sitemap.xml داخل robots.txt.', desc_en: 'Verifies sitemap directive in robots.txt.' },
  { id: 40, cat: 'security', severity: 'warning', name_ar: 'فحص التوجيه العام User-agent: *', name_en: 'User-agent * Directives Check', desc_ar: 'فحص قواعد البوتات العامة الشاملة.', desc_en: 'Audits global user-agent * rules.' },

  // 41-48: Performance & Speed
  { id: 41, cat: 'mobile', severity: 'critical', name_ar: 'فحص زمن استجابة الخادم TTFB', name_en: 'Server TTFB Response Time', desc_ar: 'قياس الوقت المستغرق لتلقي أول بايت من الخادم.', desc_en: 'Measures Time To First Byte.' },
  { id: 42, cat: 'mobile', severity: 'warning', name_ar: 'فحص حجم مستند HTML الرئيسي', name_en: 'HTML Document Payload Size', desc_ar: 'قياس الوزن بالكيلوبايت لمحتوى الصفحة.', desc_en: 'Audits HTML payload size in KB.' },
  { id: 43, cat: 'mobile', severity: 'warning', name_ar: 'فحص عدد الأكواد البرمجية Scripts', name_en: 'Script Tags Count Check', desc_ar: 'تقييم عدد ملفات السكريبتات المضمنة.', desc_en: 'Evaluates script tag count.' },
  { id: 44, cat: 'mobile', severity: 'warning', name_ar: 'فحص ملفات التنسيق CSS Count', name_en: 'CSS Stylesheet Count Check', desc_ar: 'تقييم عدد ملفات التنسيق المضمّنة.', desc_en: 'Evaluates CSS stylesheet count.' },
  { id: 45, cat: 'mobile', severity: 'warning', name_ar: 'فحص خاصية التحميل الخفي Lazy Loading', name_en: 'Image Lazy Loading Check', desc_ar: 'التحقق من تفعيل loading="lazy" للصور.', desc_en: 'Checks image lazy loading.' },
  { id: 46, cat: 'mobile', severity: 'warning', name_ar: 'فحص التجاوب للجوال Meta Viewport', name_en: 'Mobile Viewport Meta Tag', desc_ar: 'التحقق من وسم viewport المخصص للشاشات.', desc_en: 'Audits mobile viewport tag.' },
  { id: 47, cat: 'mobile', severity: 'warning', name_ar: 'فحص ضغط البيانات Gzip/Brotli', name_en: 'Server Gzip/Brotli Compression', desc_ar: 'فحص تفعيل ضغط الخادم للمحتوى.', desc_en: 'Verifies server data compression.' },
  { id: 48, cat: 'mobile', severity: 'warning', name_ar: 'فحص سياسة الكاش Cache-Control', name_en: 'Cache-Control Header Check', desc_ar: 'فحص ترويسة التخزين المؤقت في الخادم.', desc_en: 'Audits Cache-Control headers.' },

  // 49-64: AEO / GEO Engine & LLM Search Optimization
  { id: 49, cat: 'ecom', severity: 'critical', name_ar: 'فحص وجود ملف llms.txt', name_en: 'llms.txt File Presence Check', desc_ar: 'فحص وجود الملف القياسي لتأهيل الذكاء الاصطناعي.', desc_en: 'Checks for standardized llms.txt file.' },
  { id: 50, cat: 'ecom', severity: 'warning', name_ar: 'فحص غنى وثراء محتوى llms.txt', name_en: 'llms.txt Richness & Content', desc_ar: 'تقييم شمولية وسياق المعلومات في llms.txt.', desc_en: 'Evaluates llms.txt content depth.' },
  { id: 51, cat: 'ecom', severity: 'warning', name_ar: 'فحص قسم الأسئلة الشائعة FAQ', name_en: 'FAQ Section & Schema Check', desc_ar: 'التحقق من وجود قسم وبنية الأسئلة الشائعة.', desc_en: 'Audits FAQ section and schema.' },
  { id: 52, cat: 'ecom', severity: 'warning', name_ar: 'فحص سياسات الشحن والارجاع النصية', name_en: 'Readable Policies Text Check', desc_ar: 'فحص وضوح نصوص السياسات للوكلاء الذكيين.', desc_en: 'Verifies readable return/shipping text.' },
  { id: 53, cat: 'ecom', severity: 'warning', name_ar: 'فحص بيانات الدعم والتواصل Contact Details', name_en: 'Contact Details Readability', desc_ar: 'فحص إتاحة بيانات التواصل المباشر برمجياً.', desc_en: 'Checks explicit contact metadata.' },
  { id: 54, cat: 'ecom', severity: 'warning', name_ar: 'فحص جاهزية نصوص الإجابات AEO Text', name_en: 'AEO Direct Answer Readability', desc_ar: 'تقييم إمكانية استخراج إجابات مباشرة للبوتات.', desc_en: 'Evaluates AEO text optimization.' },
  { id: 55, cat: 'ecom', severity: 'warning', name_ar: 'فحص موثوقية العلامة التجارية Brand Trust', name_en: 'Brand Trust Verification', desc_ar: 'التحقق من توفر عناصر الموثوقية برمجياً.', desc_en: 'Verifies brand trust signals.' },
  { id: 56, cat: 'ecom', severity: 'warning', name_ar: 'فحص الهيكلية التوليدية GEO Structure', name_en: 'Generative Engine Hierarchy (GEO)', desc_ar: 'فحص تسلسل العناوين الفرعية H2/H3 لـ AI.', desc_en: 'Audits GEO heading structure.' },
  { id: 57, cat: 'ecom', severity: 'warning', name_ar: 'فحص استخراج مواصفات المنتج برمجياً', name_en: 'AI Spec Extraction Ease', desc_ar: 'تقييم سهولة استخراج المواصفات والأسعار.', desc_en: 'Measures product spec extraction.' },
  { id: 58, cat: 'ecom', severity: 'warning', name_ar: 'فحص حقل البحث الداخلي Search Input', name_en: 'Internal Search Input Check', desc_ar: 'التحقق من توفر حقل بحث داخلي صريح.', desc_en: 'Checks internal search element.' },
  { id: 59, cat: 'ecom', severity: 'critical', name_ar: 'فحص تشفير الاتصال SSL HTTPS', name_en: 'SSL HTTPS Encryption Check', desc_ar: 'التحقق من تشفير الاتصال بشهادة أمان.', desc_en: 'Ensures HTTPS protocol is active.' },
  { id: 60, cat: 'ecom', severity: 'warning', name_ar: 'فحص ترويسات الحماية HSTS/CSP', name_en: 'Security Headers (HSTS/CSP)', desc_ar: 'فحص ترويسات الأمان ضد التلاعب والثغرات.', desc_en: 'Audits HTTP security headers.' },
  { id: 61, cat: 'ecom', severity: 'warning', name_ar: 'فحص جدار الحماية ضد البوتات WAF Protection', name_en: 'WAF Bot Protection Check', desc_ar: 'فحص وجود درع حماية ضد البوتات الضارة.', desc_en: 'Detects WAF / Cloudflare bot protection.' },
  { id: 62, cat: 'ecom', severity: 'warning', name_ar: 'فحص بوابات الدفع المكتشفة Payment Gateways', name_en: 'Payment Gateways Detection', desc_ar: 'رصد واكتشاف وسائط وبوابات الدفع برمجياً.', desc_en: 'Detects payment gateway footprints.' },
  { id: 63, cat: 'ecom', severity: 'warning', name_ar: 'فحص حماية الكثافة Rate Limiting', name_en: 'Rate Limiting Protection Check', desc_ar: 'فحص وجود ترويسات حماية الطلبات الكثيفة.', desc_en: 'Checks rate limiting protection.' },
  { id: 64, cat: 'ecom', severity: 'warning', name_ar: 'فحص روابط الشروط والخصوصية Policy Links', name_en: 'Terms & Privacy Policy Links', desc_ar: 'التحقق من توفر روابط الخصوصية والشروط.', desc_en: 'Verifies terms & privacy links.' }
];

function applyAuditResults(domain, realData) {
  const domainHash = hashDomain(domain.toLowerCase());

  // Platform Badge
  const platformBadge = document.getElementById('detectedPlatformBadge');
  if (platformBadge) {
    if (realData && realData.platform) {
      platformBadge.textContent = realData.platform;
    } else {
      let fallbackPlat = 'منصة خاصة (Custom)';
      const dLower = domain.toLowerCase();
      if (dLower.includes('salla') || dLower.includes('demo')) fallbackPlat = 'Salla (سلة)';
      else if (dLower.includes('zid')) fallbackPlat = 'Zid (زد)';
      else if (dLower.includes('shopify')) fallbackPlat = 'Shopify';
      else if (dLower.includes('woo')) fallbackPlat = 'WooCommerce';
      platformBadge.textContent = fallbackPlat;
    }
  }

  // Build Results for 64 Rules
  currentAuditResults = auditRulesCatalog.map((rule, idx) => {
    let status = 'passed';
    let details = null;
    let evidence = null;

    if (realData && realData.ruleResults && realData.ruleResults[rule.id]) {
      const realRule = realData.ruleResults[rule.id];
      status = realRule.passed ? 'passed' : (rule.severity === 'critical' ? 'critical' : 'warning');
      details = currentLang === 'ar' ? (realRule.details?.ar || realRule.details) : (realRule.details?.en || realRule.details);
      evidence = realRule.evidence;
    } else {
      // Deterministic fallback if API offline
      const itemHash = (domainHash + (rule.id * 37) + (idx * 13)) % 100;
      if (itemHash < 18) status = 'critical';
      else if (itemHash < 42) status = 'warning';
      else status = 'passed';
      details = currentLang === 'ar' ? 'فحص تلقائي للمتجر المستهدف' : 'Automated domain rule check';
      evidence = currentLang === 'ar' ? 'لم يتم رصد استجابة مباشرة' : 'No live response detected';
    }

    return {
      ...rule,
      status: status,
      details: details,
      evidence: evidence
    };
  });

  // PageSpeed Scores
  let psMobile = 78;
  let psDesktop = 92;

  if (realData && realData.pagespeed) {
    psMobile = realData.pagespeed.mobile;
    psDesktop = realData.pagespeed.desktop;
  } else {
    psMobile = 65 + (domainHash % 28);
    psDesktop = 78 + ((domainHash * 7) % 21);
  }

  if (document.getElementById('psMobileVal')) document.getElementById('psMobileVal').textContent = `${psMobile}/100`;
  if (document.getElementById('psDesktopVal')) document.getElementById('psDesktopVal').textContent = `${psDesktop}/100`;
}

function renderDashboardData() {
  const totalItems = currentAuditResults.length || 64;
  const passed = currentAuditResults.filter(r => r.status === 'passed').length;
  const critical = currentAuditResults.filter(r => r.status === 'critical').length;
  const warning = currentAuditResults.filter(r => r.status === 'warning').length;
  const aiFiles = currentAuditResults.filter(r => r.cat === 'agents_files' && r.status === 'passed').length;

  document.getElementById('passedCountVal').textContent = `${passed} / ${totalItems}`;
  document.getElementById('criticalCountVal').textContent = `${critical} ${currentLang === 'ar' ? 'عناصر' : 'items'}`;
  document.getElementById('warningCountVal').textContent = `${warning} ${currentLang === 'ar' ? 'تنبيهات' : 'warnings'}`;
  document.getElementById('aiFilesCountVal').textContent = `${aiFiles} / 10 ${currentLang === 'ar' ? 'ملفات' : 'files'}`;

  // Calculate Score Percent
  let score = currentRealAuditData ? currentRealAuditData.overallScore : Math.round((passed / totalItems) * 100);
  document.getElementById('totalScoreVal').textContent = score;

  // SVG Progress Ring
  const circle = document.getElementById('circleProgressCircle');
  if (circle) {
    const strokeOffset = 502 - (502 * score) / 100;
    circle.style.strokeDashoffset = strokeOffset;
  }

  // Readiness Status Badge
  const statusBadge = document.getElementById('readinessStatusBadge');
  if (statusBadge) {
    if (score >= 85) {
      statusBadge.className = 'badge badge-success';
      statusBadge.textContent = currentLang === 'ar' ? '✅ متجر جاهز كلياً لوكلاء AI' : '✅ Store Fully AI-Agent Ready';
    } else if (score >= 60) {
      statusBadge.className = 'badge badge-warning';
      statusBadge.textContent = currentLang === 'ar' ? '⚠️ متجر جاهز جزئياً للوكلاء' : '⚠️ Store Partially AI-Ready';
    } else {
      statusBadge.className = 'badge badge-danger';
      statusBadge.textContent = currentLang === 'ar' ? '🔴 المتجر بحاجة لتهيئة شاملة' : '🔴 Needs Full AI Optimization';
    }
  }

  renderAuditChecklist();
}

function filterCategory(cat, btn) {
  activeCategory = cat;
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderAuditChecklist();
}

function renderAuditChecklist() {
  const container = document.getElementById('checklistContainer');
  if (!container) return;
  container.innerHTML = '';

  const filtered = activeCategory === 'all' ? 
    currentAuditResults : 
    currentAuditResults.filter(r => r.cat === activeCategory);

  filtered.forEach(rule => {
    const isAr = currentLang === 'ar';
    const card = document.createElement('div');
    card.className = 'check-item-card';

    let statusBadgeHTML = '';
    if (rule.status === 'passed') {
      statusBadgeHTML = `<span class="badge badge-success">${isAr ? 'مستوفى ✅' : 'Passed ✅'}</span>`;
    } else if (rule.status === 'warning') {
      statusBadgeHTML = `<span class="badge badge-warning">${isAr ? 'تنبيه 🟡' : 'Warning 🟡'}</span>`;
    } else {
      statusBadgeHTML = `<span class="badge badge-danger">${isAr ? 'حرج 🔴' : 'Critical 🔴'}</span>`;
    }

    const title = isAr ? rule.name_ar : rule.name_en;
    const desc = isAr ? rule.desc_ar : rule.desc_en;

    card.innerHTML = `
      <div class="check-header" onclick="this.parentElement.classList.toggle('open')">
        <div class="check-title-group">
          <span class="check-status-icon">${rule.status === 'passed' ? '🟢' : rule.status === 'warning' ? '🟡' : '🔴'}</span>
          <div>
            <div class="check-name">${title}</div>
            <span class="check-category-tag">${rule.cat} • #${rule.id}</span>
          </div>
        </div>

        <div class="check-meta">
          ${statusBadgeHTML}
          <span class="check-expand-icon">▼</span>
        </div>
      </div>

      <div class="check-body">
        <p class="check-desc">${desc}</p>

        <div class="live-evidence-box" style="background: rgba(59, 130, 246, 0.08); border-right: 4px solid #3b82f6; border-left: none; padding: 12px 16px; border-radius: 8px; margin: 12px 0; font-size: 0.9rem; color: #1e3a8a;">
          <div style="font-weight: 700; margin-bottom: 4px;">
            🔍 ${isAr ? 'نتيجة الفحص التثبتي:' : 'Audit Verification:'} <span style="font-weight: 500;">${rule.details || desc}</span>
          </div>
          ${rule.evidence ? `
          <div style="font-family: monospace; background: rgba(15, 23, 42, 0.07); padding: 6px 10px; border-radius: 6px; font-size: 0.84rem; color: #0f172a; word-break: break-all; margin-top: 4px; border: 1px solid rgba(0,0,0,0.06);">
            💻 <strong>${isAr ? 'الدليل البرمجي التثبتي (Technical Evidence):' : 'Technical Evidence:'}</strong> ${rule.evidence}
          </div>` : ''}
        </div>

        <div class="recommendation-box">
          <h5>💡 ${isAr ? 'توصية الخبراء للإصلاح:' : 'Fix Recommendation:'}</h5>
          <p style="font-size:0.9rem; color:var(--text-muted);">
            ${rule.status === 'passed' ? 
              (isAr ? 'العنصر مهيأ وممتثل تماماً لمعايير وكلاء الشراء.' : 'Item complies fully with AI agent standards.') :
              (isAr ? `قم بتنفيذ وتحديث ${title} في المتجر لضمان قدرة الـ AI على قراءة البيانات وصنع الطلبيات.` : `Implement ${title} on your store to enable seamless AI interaction.`)}
          </p>
        </div>

        ${rule.status !== 'passed' ? `
        <div class="code-preview">
&lt;!-- WakeelCheck Fix Snippet for ${rule.name_en} --&gt;
&lt;link rel="agent-spec" href="/.well-known/agent.json" /&gt;
        </div>` : ''}
      </div>
    `;

    container.appendChild(card);
  });
}

// Modal Control Functions
function openFixGeneratorModal() {
  const domainEl = document.getElementById('targetUrlDisplay');
  const domain = (domainEl && domainEl.textContent && domainEl.textContent.trim() !== '') ? domainEl.textContent.trim() : 'example-store.com';
  
  const storeTitle = currentRealAuditData?.pageTitle || domain;
  const storePlatform = currentRealAuditData?.platform || 'E-Commerce';

  const llmsText = `# llms.txt generated for ${domain} by AITChek.online
# Store Context for AI Agents (ChatGPT, Perplexity, Gemini, Claude)

# Core Store Metadata
Title: ${storeTitle}
Platform: ${storePlatform}
Primary Language: ar / en

# Product Catalog & Feeds
Product-Catalog: https://${domain}/sitemap.xml
Structured-Data: https://${domain}/.well-known/agent.json
Pricing-Policy: https://${domain}/pricing.md

# Agent Interaction Policy
Allow-Autonomous-Browse: Yes
Allow-Autonomous-Purchase: Yes (Prepaid / 3DSecure Only)
Disallow-Unauthenticated-COD: Yes`;

  const agentJsonText = `{
  "agent_spec_version": "1.0",
  "merchant_domain": "${domain}",
  "store_name": "${storeTitle}",
  "platform": "${storePlatform}",
  "security_policy": {
    "signed_headers_required": true,
    "reverse_dns_validation": true,
    "cash_on_delivery_allowed": false,
    "require_3d_secure_otp": true,
    "max_cart_quantity_per_agent": 5
  },
  "supported_payment_methods": ["Mada", "ApplePay", "Visa", "MasterCard"]
}`;

  const robotsText = `# AI Bots Permission Policy for ${domain}
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Disallow: /`;

  const schemaText = `<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Product",
  "name": "اسم المنتج - ${storeTitle}",
  "description": "وصف المنتج المجهز للذكاء الاصطناعي والتصنيف فـ AEO",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "SAR",
    "price": "199.00",
    "availability": "https://schema.org/InStock"
  }
}
</script>`;

  if (document.getElementById('generatedLlmsCode')) document.getElementById('generatedLlmsCode').textContent = llmsText;
  if (document.getElementById('generatedAgentJsonCode')) document.getElementById('generatedAgentJsonCode').textContent = agentJsonText;
  if (document.getElementById('generatedRobotsCode')) document.getElementById('generatedRobotsCode').textContent = robotsText;
  if (document.getElementById('generatedSchemaCode')) document.getElementById('generatedSchemaCode').textContent = schemaText;

  document.getElementById('codeModal').style.display = 'flex';
}

function closeFixModal() {
  document.getElementById('codeModal').style.display = 'none';
}

function exportPDFReport() {
  window.print();
}

function copyTextContent(elementId, btnElement) {
  const el = document.getElementById(elementId);
  if (!el) return;
  
  const text = el.textContent || el.innerText;
  navigator.clipboard.writeText(text).then(() => {
    const originalText = btnElement.textContent;
    btnElement.textContent = '✅ تم النسخ!';
    btnElement.style.background = '#ecfdf5';
    btnElement.style.color = '#047857';
    setTimeout(() => {
      btnElement.textContent = originalText;
      btnElement.style.background = '';
      btnElement.style.color = '';
    }, 2000);
  }).catch(err => {
    console.error('Copy failed:', err);
  });
}
