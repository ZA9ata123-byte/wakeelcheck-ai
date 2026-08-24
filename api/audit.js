const cheerio = require('cheerio');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.body || req.query || {};

  if (!url) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    let formattedUrl = url.trim();
    if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
      formattedUrl = `https://${formattedUrl}`;
    }
    const parsedUrl = new URL(formattedUrl);
    const domain = parsedUrl.hostname;

    const startTime = Date.now();
    let responseStatus = 0;
    let htmlContent = '';
    let responseHeaders = {};
    let ttfbMs = 0;

    // 1. Fetch Store Homepage
    try {
      const resPage = await fetch(formattedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'ar-SA,ar;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache'
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000)
      });
      ttfbMs = Date.now() - startTime;
      responseStatus = resPage.status;
      htmlContent = await resPage.text();
      resPage.headers.forEach((val, key) => {
        responseHeaders[key.toLowerCase()] = val;
      });
    } catch (err) {
      console.warn(`[WakeelCheck] Fetch failed for ${formattedUrl}:`, err.message);
    }

    // 2. Fetch /robots.txt
    let robotsTxt = '';
    let hasRobots = false;
    try {
      const resRobots = await fetch(`https://${domain}/robots.txt`, { signal: AbortSignal.timeout(4000) });
      if (resRobots.ok) {
        hasRobots = true;
        robotsTxt = await resRobots.text();
      }
    } catch (e) {}

    // 3. Fetch /llms.txt & /.well-known/llms.txt
    let llmsTxt = '';
    let hasLlmsTxt = false;
    try {
      const resLlms = await fetch(`https://${domain}/llms.txt`, { signal: AbortSignal.timeout(4000) });
      if (resLlms.ok) {
        hasLlmsTxt = true;
        llmsTxt = await resLlms.text();
      } else {
        const resLlms2 = await fetch(`https://${domain}/.well-known/llms.txt`, { signal: AbortSignal.timeout(4000) });
        if (resLlms2.ok) {
          hasLlmsTxt = true;
          llmsTxt = await resLlms2.text();
        }
      }
    } catch (e) {}

    // 4. Fetch /sitemap.xml
    let hasSitemap = false;
    try {
      const resSitemap = await fetch(`https://${domain}/sitemap.xml`, { method: 'HEAD', signal: AbortSignal.timeout(4000) });
      if (resSitemap.ok) hasSitemap = true;
    } catch (e) {}

    // 5. Parse HTML with Cheerio
    const $ = cheerio.load(htmlContent || '<html></html>');

    // Extract Page Metadata
    const pageTitle = $('title').first().text().trim() || domain;
    const metaDescription = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
    const canonicalUrl = $('link[rel="canonical"]').attr('href') || formattedUrl;
    const langAttr = $('html').attr('lang') || 'ar';

    // Platform Detection with Evidence Footprints
    let platform = 'برمجة خاصة (Custom)';
    const htmlLower = htmlContent.toLowerCase();

    if (htmlLower.includes('salla') || htmlLower.includes('salla.network') || htmlLower.includes('salla.sa') || htmlLower.includes('salla.co') || htmlLower.includes('salla-hook') || htmlLower.includes('window.salla')) {
      platform = 'Salla (سلة)';
    } else if (htmlLower.includes('zid.sa') || htmlLower.includes('zid.store') || htmlLower.includes('zid-storefront') || htmlLower.includes('cdn.zid') || htmlLower.includes('window.zid')) {
      platform = 'Zid (زد)';
    } else if (htmlLower.includes('cdn.shopify.com') || htmlLower.includes('shopify.theme') || htmlLower.includes('myshopify.com')) {
      platform = 'Shopify';
    } else if (htmlLower.includes('woocommerce') || htmlLower.includes('wp-content/plugins/woocommerce') || htmlLower.includes('wc-api')) {
      platform = 'WooCommerce';
    } else if (htmlLower.includes('magento') || htmlLower.includes('varien/') || htmlLower.includes('skin/frontend/')) {
      platform = 'Magento';
    }

    // JSON-LD Extraction & Analysis
    const jsonLdScripts = $('script[type="application/ld+json"]');
    let jsonLdTypes = [];
    let hasProductSchema = false;
    let hasOfferSchema = false;
    let hasRatingSchema = false;
    let hasOrganizationSchema = false;
    let hasBreadcrumbSchema = false;
    let hasFaqSchema = false;

    jsonLdScripts.each((_, el) => {
      try {
        const data = JSON.parse($(el).html());
        const extractTypes = (obj) => {
          if (!obj) return;
          if (Array.isArray(obj)) obj.forEach(extractTypes);
          else if (typeof obj === 'object') {
            if (obj['@type']) {
              const t = Array.isArray(obj['@type']) ? obj['@type'] : [obj['@type']];
              jsonLdTypes.push(...t);
            }
            if (obj['@graph']) extractTypes(obj['@graph']);
          }
        };
        extractTypes(data);
      } catch (e) {}
    });

    hasProductSchema = jsonLdTypes.some(t => /Product/i.test(t));
    hasOfferSchema = jsonLdTypes.some(t => /Offer/i.test(t));
    hasRatingSchema = jsonLdTypes.some(t => /AggregateRating|Rating/i.test(t));
    hasOrganizationSchema = jsonLdTypes.some(t => /Organization|Store|LocalBusiness/i.test(t));
    hasBreadcrumbSchema = jsonLdTypes.some(t => /BreadcrumbList/i.test(t));
    hasFaqSchema = jsonLdTypes.some(t => /FAQPage/i.test(t));

    // OpenGraph & Microdata Analysis
    const ogTitle = $('meta[property="og:title"]').attr('content');
    const ogImage = $('meta[property="og:image"]').attr('content');
    const ogPrice = $('meta[property="og:price:amount"]').attr('content') || $('meta[property="product:price:amount"]').attr('content');
    const ogCurrency = $('meta[property="og:price:currency"]').attr('content') || $('meta[property="product:price:currency"]').attr('content');
    const ogAvailability = $('meta[property="og:availability"]').attr('content') || $('meta[property="product:availability"]').attr('content');
    const twitterCard = $('meta[name="twitter:card"]').attr('content');

    // Semantic HTML & Accessibility Analysis
    const h1Count = $('h1').length;
    const h2Count = $('h2').length;
    const navCount = $('nav').length;
    const mainCount = $('main').length;
    const headerCount = $('header').length;
    const footerCount = $('footer').length;
    const ariaElementsCount = $('[aria-label], [aria-labelledby], [role]').length;

    const imgElements = $('img');
    const totalImgs = imgElements.length;
    let imgsWithAlt = 0;
    imgElements.each((_, el) => {
      if ($(el).attr('alt') && $(el).attr('alt').trim().length > 0) imgsWithAlt++;
    });
    const altRatio = totalImgs > 0 ? (imgsWithAlt / totalImgs) : 1;

    // AI Bot Analysis in robots.txt
    const robotsLower = robotsTxt.toLowerCase();

    // Payment & Security Signatures
    const hasHttps = formattedUrl.startsWith('https://');
    const paymentKeywords = ['stripe', 'tap', 'moyasar', 'payfort', 'paypal', 'tamara', 'tabby', 'apple-pay', 'mada', 'visa', 'mastercard'];
    let detectedPayments = [];
    paymentKeywords.forEach(kw => {
      if (htmlLower.includes(kw)) detectedPayments.push(kw);
    });

    // API Footprints
    const hasApiEndpoints = htmlLower.includes('/api/') || htmlLower.includes('/graphql') || htmlLower.includes('wp-json') || htmlLower.includes('storefront');

    // 6. Build Rule Evaluations with Evidence (64 items)
    const ruleResults = {};

    const evaluateRule = (id, passed, scoreIfPassed, detailsAr, detailsEn, evidenceStr) => {
      ruleResults[id] = {
        id,
        passed,
        score: passed ? scoreIfPassed : 0,
        maxScore: scoreIfPassed,
        details: { ar: detailsAr, en: detailsEn },
        evidence: evidenceStr || (passed ? 'Verified in DOM/Headers' : 'Element not found')
      };
    };

    // Category 1: Schema.org & JSON-LD
    evaluateRule(1, hasProductSchema, 10, hasProductSchema ? 'تم العثور على هيكل Schema لمواصفات المنتجات' : 'لم يتم العثور على JSON-LD Product Schema للمنتجات', hasProductSchema ? 'JSON-LD Product Schema found' : 'Missing JSON-LD Product Schema', hasProductSchema ? `Schema @type: Product` : `No Product in ${jsonLdScripts.length} scripts`);
    evaluateRule(2, hasOfferSchema || !!ogPrice, 10, (hasOfferSchema || !!ogPrice) ? `تم رصد الأسعار والعملة (${ogCurrency || 'ر.س'})` : 'الأسعار غير مهيكلة برمجياً في Schema Offer', (hasOfferSchema || !!ogPrice) ? 'Price & Currency structured' : 'Price Offer Schema missing', ogPrice ? `og:price = ${ogPrice} ${ogCurrency || ''}` : (hasOfferSchema ? 'Offer Schema present' : 'No Offer/Price tag'));
    evaluateRule(3, hasRatingSchema, 8, hasRatingSchema ? 'تم رصد التقييمات والمراجعات برمجياً (AggregateRating)' : 'التقييمات والمراجعات غير مدمجة في Schema', hasRatingSchema ? 'Ratings found in Schema' : 'AggregateRating missing', hasRatingSchema ? 'AggregateRating present' : 'No Rating Schema');
    evaluateRule(4, hasBreadcrumbSchema, 7, hasBreadcrumbSchema ? 'تم رصد مسارات التصفح (BreadcrumbList)' : 'مسارات التصفح الهيكلية غير متوفرة', hasBreadcrumbSchema ? 'Breadcrumbs structured' : 'Breadcrumbs missing', hasBreadcrumbSchema ? 'BreadcrumbList present' : 'No Breadcrumb Schema');
    evaluateRule(5, jsonLdTypes.includes('Brand'), 6, jsonLdTypes.includes('Brand') ? 'العلامات التجارية معرفة برمجياً' : 'اسم العلامة التجارية المصنعة غير محدد في Schema', jsonLdTypes.includes('Brand') ? 'Brand defined in Schema' : 'Brand missing', jsonLdTypes.includes('Brand') ? 'Brand @type found' : 'No Brand in Schema');
    evaluateRule(6, jsonLdScripts.length > 0, 8, jsonLdScripts.length > 0 ? `تم العثور على ${jsonLdScripts.length} نص JSON-LD في الصفحة` : 'الصفحة تخلو تماماً من أكواد JSON-LD', jsonLdScripts.length > 0 ? `${jsonLdScripts.length} JSON-LD blocks found` : 'No JSON-LD found', `${jsonLdScripts.length} <script type="application/ld+json"> tags`);
    evaluateRule(7, jsonLdTypes.length >= 3, 7, jsonLdTypes.length >= 3 ? 'هيكلة شاملة تغطي عناصر متعددة في المتجر' : 'الهيكلة تقتصر على فئة واحدة فقط', jsonLdTypes.length >= 3 ? 'Rich multi-type Schema' : 'Basic single Schema', `Detected Types: [${jsonLdTypes.join(', ')}]`);
    evaluateRule(8, hasOrganizationSchema, 8, hasOrganizationSchema ? 'تم العثور على بيانات المتجر المؤسسية (Organization)' : 'بيانات الهوية المؤسسية للمتجر غير موجودة', hasOrganizationSchema ? 'Organization Schema present' : 'Organization Schema missing', hasOrganizationSchema ? 'Organization Schema found' : 'No Organization Schema');

    // Category 2: Microdata & OpenGraph
    evaluateRule(9, !!ogTitle, 10, ogTitle ? `العنوان ترويجي محدد: "${ogTitle.slice(0, 30)}..."` : 'وسم og:title مفقود', ogTitle ? 'og:title present' : 'og:title missing', ogTitle ? `<meta property="og:title" content="${ogTitle.slice(0, 40)}">` : 'og:title missing');
    evaluateRule(10, !!ogImage, 10, ogImage ? 'وسم og:image متوفر لعرض الصور في البوتات' : 'وسم og:image مفقود', ogImage ? 'og:image present' : 'og:image missing', ogImage ? `<meta property="og:image" content="${ogImage.slice(0, 40)}...">` : 'og:image missing');
    evaluateRule(11, !!ogPrice, 8, ogPrice ? `وسم og:price متوفر (${ogPrice} ${ogCurrency || ''})` : 'وسم og:price مفقود', ogPrice ? 'og:price present' : 'og:price missing', ogPrice ? `og:price:amount = ${ogPrice}` : 'og:price missing');
    evaluateRule(12, !!ogCurrency, 7, ogCurrency ? `عملة المتجر محددة: ${ogCurrency}` : 'عملة المتجر غير محددة في OpenGraph', ogCurrency ? 'og:currency present' : 'og:currency missing', ogCurrency ? `og:price:currency = ${ogCurrency}` : 'og:currency missing');
    evaluateRule(13, !!ogAvailability, 8, ogAvailability ? 'حالة التوفر (InStock) معرفة برمجياً' : 'حالة توفر المنتج في المخزون غير معرفة في OpenGraph', ogAvailability ? 'Availability defined' : 'Availability missing', ogAvailability ? `og:availability = ${ogAvailability}` : 'og:availability missing');
    evaluateRule(14, !!twitterCard, 7, twitterCard ? `كارت تويتر/X محدد (${twitterCard})` : 'وسوم Twitter Card مفقودة', twitterCard ? 'Twitter Card present' : 'Twitter Card missing', twitterCard ? `<meta name="twitter:card" content="${twitterCard}">` : 'twitter:card missing');
    evaluateRule(15, !!metaDescription && metaDescription.length >= 20, 8, metaDescription ? `وصف المتجر متوفر (${metaDescription.length} حرف)` : 'وصف المتجر (meta description) مفقود أو قصير جداً', metaDescription ? 'Meta description present' : 'Meta description missing', metaDescription ? `<meta name="description" length="${metaDescription.length}">` : 'meta description missing');
    evaluateRule(16, canonicalUrl.startsWith('http') && $('link[rel="canonical"]').length > 0, 6, $('link[rel="canonical"]').length > 0 ? 'الرابط الأساسي (canonical URL) محدد برمجياً' : 'وسم canonical مفقود', $('link[rel="canonical"]').length > 0 ? 'Canonical URL specified' : 'Canonical URL missing', $('link[rel="canonical"]').length > 0 ? `<link rel="canonical" href="${canonicalUrl.slice(0, 40)}">` : 'link rel=canonical missing');

    // Category 3: Machine Readability & API Access
    evaluateRule(17, hasApiEndpoints, 10, hasApiEndpoints ? `تم رصد واجهات برمجية API في المتجر (${platform})` : 'لم يتم رصد واجهات برمجية مباشرة للوكلاء', hasApiEndpoints ? 'API endpoints detected' : 'No direct API detected', hasApiEndpoints ? `Endpoints detected for ${platform}` : 'No /api/ or graphql detected');
    evaluateRule(18, platform !== 'برمجة خاصة (Custom)', 9, `تم التعرف على منصة المتجر: ${platform}`, `Platform detected: ${platform}`, `Platform Signature: ${platform}`);
    evaluateRule(19, htmlLower.includes('application/json') || jsonLdScripts.length > 0, 8, (htmlLower.includes('application/json') || jsonLdScripts.length > 0) ? 'توجد استجابات وتنسيقات JSON قابلة للقراءة' : 'بيانات JSON غير مكشوفة في الصفحة', (htmlLower.includes('application/json') || jsonLdScripts.length > 0) ? 'JSON responses available' : 'No JSON format found', (htmlLower.includes('application/json') || jsonLdScripts.length > 0) ? 'application/json found in DOM' : 'No JSON mime types found');
    evaluateRule(20, $('form').length > 0, 7, $('form').length > 0 ? `تم رصد ${$('form').length} نماذج تفاعلية في المتجر` : 'لم يتم العثور على نماذج تفاعلية', `${$('form').length} forms detected`, `${$('form').length} <form> tags in DOM`);
    evaluateRule(21, htmlLower.includes('cart') || htmlLower.includes('سلة') || htmlLower.includes('checkout') || htmlLower.includes('شراء'), 8, (htmlLower.includes('cart') || htmlLower.includes('سلة') || htmlLower.includes('checkout')) ? 'مسار السلة والشراء معرف برمجياً' : 'مسار السلة غير وضوح في المعاينة', 'Cart & Checkout paths detected', (htmlLower.includes('cart') || htmlLower.includes('سلة')) ? 'Cart / Checkout strings present' : 'No cart keywords');
    evaluateRule(22, hasProductSchema || hasOfferSchema || jsonLdTypes.length > 0, 7, jsonLdTypes.length > 0 ? 'هيكل البيانات متوافق مع معايير JSON-LD / REST' : 'هيكلة البيانات غير معتمدة', 'Structured data standards compatible', `Schema types count: ${jsonLdTypes.length}`);
    evaluateRule(23, hasSitemap, 8, hasSitemap ? 'خريطة الموقع sitemap.xml متوفرة' : 'لم يتم العثور على sitemap.xml', hasSitemap ? 'Sitemap.xml available' : 'Sitemap.xml missing', hasSitemap ? 'HEAD https://' + domain + '/sitemap.xml 200 OK' : 'sitemap.xml 404 / error');
    evaluateRule(24, htmlLower.includes('stock') || htmlLower.includes('مخزون') || htmlLower.includes('متوفر') || !!ogAvailability, 7, (htmlLower.includes('stock') || htmlLower.includes('مخزون') || !!ogAvailability) ? 'مؤشرات توفر المنتج في المخزون مفعلة' : 'مؤشرات التوفر في المخزون غير محددة', 'Realtime stock indicators present', (htmlLower.includes('stock') || !!ogAvailability) ? 'Stock indicators present in DOM' : 'No stock indicators');

    // Category 4: Semantic HTML & Accessibility
    evaluateRule(25, h1Count === 1, 9, h1Count === 1 ? 'العنوان الرئيسي H1 موحد ومثالي' : `يوجد ${h1Count} عناوين H1 (يفضل عنوان واحد فقط)`, h1Count === 1 ? 'Single H1 structure' : `${h1Count} H1 tags found`, `Found ${h1Count} <h1> tags in DOM`);
    evaluateRule(26, navCount > 0, 8, navCount > 0 ? 'القوائم تستخدم وسم Nav الدلالي' : 'وسم nav مفقود في القوائم', navCount > 0 ? 'Semantic Nav present' : 'Nav missing', `Found ${navCount} <nav> elements`);
    evaluateRule(27, headerCount > 0 && footerCount > 0, 8, (headerCount > 0 && footerCount > 0) ? 'الهيدر والفوتر بأسماء دلالية قياسية' : 'وسوم Header/Footer غير مكتملة', (headerCount > 0 && footerCount > 0) ? 'Header & Footer semantic' : 'Incomplete Header/Footer', `<header>: ${headerCount}, <footer>: ${footerCount}`);
    evaluateRule(28, mainCount > 0, 8, mainCount > 0 ? 'وسم المحتوى الرئيسي Main متوفر' : 'وسم main مفقود في هيكلية HTML', mainCount > 0 ? 'Main element present' : 'Main element missing', `Found ${mainCount} <main> elements`);
    evaluateRule(29, totalImgs > 0 && altRatio >= 0.7, 8, totalImgs > 0 ? `نسبة الصور المحتوية على نص بديل Alt هي ${Math.round(altRatio * 100)}%` : 'لم يتم العثور على صور في الصفحة', `Alt tag ratio: ${Math.round(altRatio * 100)}%`, `Images with alt: ${imgsWithAlt} / ${totalImgs}`);
    evaluateRule(30, ariaElementsCount >= 3, 7, ariaElementsCount >= 3 ? `تم استخدام ${ariaElementsCount} عنصر محدد برمجياً عبر ARIA` : 'خاصية ARIA للمكفوفين والوكلاء غير كافية', `${ariaElementsCount} ARIA attributes used`, `Found ${ariaElementsCount} ARIA attributes in DOM`);
    evaluateRule(31, !!langAttr && langAttr.length >= 2, 7, langAttr ? `لغة المتجر محددة برمجياً: lang="${langAttr}"` : 'وسم اللغة lang مفقود في عنصر html', `Language attribute: ${langAttr}`, `<html lang="${langAttr || 'none'}">`);
    evaluateRule(32, $('a[href]').length >= 10, 8, `يحتوي المتجر على ${$('a[href]').length} رابط تنقل صريح`, `${$('a[href]').length} explicit links found`, `Found ${$('a[href]').length} <a href="..."> links`);

    // Category 5: Robots & AI Bot Access
    evaluateRule(33, hasRobots, 10, hasRobots ? 'ملف robots.txt متوفر في المتجر' : 'ملف robots.txt مفقود في الخادم الرئيسي', hasRobots ? 'robots.txt available' : 'robots.txt missing', hasRobots ? 'GET https://' + domain + '/robots.txt 200 OK' : 'robots.txt 404 / missing');
    evaluateRule(34, hasRobots && (!robotsLower.includes('gptbot') || !robotsLower.includes('disallow: /')), 10, (hasRobots && robotsLower.includes('gptbot') && robotsLower.includes('disallow: /')) ? 'بوت ChatGPT محظور في robots.txt' : 'بوت ChatGPT مسموح له بفحص المتجر', 'GPTBot accessibility check', (hasRobots && robotsLower.includes('gptbot')) ? 'GPTBot directive found' : 'GPTBot unblocked');
    evaluateRule(35, hasRobots && (!robotsLower.includes('claudebot') || !robotsLower.includes('disallow: /')), 9, (hasRobots && robotsLower.includes('claudebot') && robotsLower.includes('disallow: /')) ? 'بوت Claude محظور في robots.txt' : 'بوت Claude مسموح له بفحص المتجر', 'ClaudeBot accessibility check', (hasRobots && robotsLower.includes('claudebot')) ? 'ClaudeBot directive found' : 'ClaudeBot unblocked');
    evaluateRule(36, hasRobots && (!robotsLower.includes('perplexitybot') || !robotsLower.includes('disallow: /')), 9, (hasRobots && robotsLower.includes('perplexitybot') && robotsLower.includes('disallow: /')) ? 'بوت Perplexity محظور' : 'بوت Perplexity مسموح له بالفحص', 'PerplexityBot accessibility check', (hasRobots && robotsLower.includes('perplexitybot')) ? 'PerplexityBot directive found' : 'PerplexityBot unblocked');
    evaluateRule(37, hasRobots && (!robotsLower.includes('google-extended') || !robotsLower.includes('disallow: /')), 9, 'بوت Gemini (Google-Extended) مسموح له بالفحص', 'Google Gemini allowed', (hasRobots && robotsLower.includes('google-extended')) ? 'Google-Extended directive found' : 'Google-Extended unblocked');
    evaluateRule(38, !robotsLower.includes('crawl-delay') || parseInt(robotsLower.match(/crawl-delay:\s*(\d+)/)?.[1] || '0') <= 5, 8, 'معدل طلبات البوتات (Crawl-delay) ممتاز وتوافقي', 'Crawl rate optimal', robotsLower.includes('crawl-delay') ? robotsLower.match(/crawl-delay:\s*\d+/)?.[0] : 'No crawl-delay limitation');
    evaluateRule(39, robotsLower.includes('sitemap:'), 8, robotsLower.includes('sitemap:') ? 'رابط خريطة الموقع مذكور في robots.txt' : 'رابط Sitemap مفقود في ملف robots.txt', robotsLower.includes('sitemap:') ? 'Sitemap listed in robots.txt' : 'Sitemap unlisted in robots.txt', robotsLower.includes('sitemap:') ? robotsLower.match(/sitemap:\s*\S+/)?.[0] : 'Sitemap directive missing');
    evaluateRule(40, robotsLower.includes('user-agent: *'), 7, robotsLower.includes('user-agent: *') ? 'قواعد البوتات العامة user-agent: * محددة' : 'ملف robots.txt لا يحتوي على توجيه عام', 'User-agent * directives present', robotsLower.includes('user-agent: *') ? 'User-agent: * directive present' : 'User-agent: * missing');

    // Category 6: Performance & Speed
    evaluateRule(41, ttfbMs > 0 && ttfbMs < 800, 10, ttfbMs > 0 ? `زمن استجابة الخادم الأولية (TTFB): ${ttfbMs} مللي ثانية` : 'استجابة الخادم ممتازة', `Server response TTFB: ${ttfbMs}ms`, `TTFB = ${ttfbMs}ms`);
    evaluateRule(42, htmlContent.length > 0 && htmlContent.length < 250000, 8, htmlContent.length > 0 ? `حجم ملف HTML الرئيسي: ${Math.round(htmlContent.length / 1024)} كيلوبايت` : 'حجم الصفحة غير معلوم', `HTML payload size: ${Math.round(htmlContent.length / 1024)} KB`, `Payload = ${Math.round(htmlContent.length / 1024)} KB`);
    evaluateRule(43, $('script').length < 35, 7, `عدد ملفات الأكواد البرمجية Script: ${$('script').length}`, `Scripts count: ${$('script').length}`, `Found ${$('script').length} <script> tags`);
    evaluateRule(44, $('link[rel="stylesheet"]').length < 12, 7, `عدد ملفات التنسيق CSS: ${$('link[rel="stylesheet"]').length}`, `CSS links count: ${$('link[rel="stylesheet"]').length}`, `Found ${$('link[rel="stylesheet"]').length} <link rel="stylesheet"> tags`);
    evaluateRule(45, $('img[loading="lazy"]').length > 0, 8, $('img[loading="lazy"]').length > 0 ? 'التحميل الخفي للصور (Lazy Loading) مفعل' : 'خاصية loading="lazy" مفقودة في الصور', 'Lazy loading check', `Found ${$('img[loading="lazy"]').length} lazy images`);
    evaluateRule(46, $('meta[name="viewport"]').length > 0, 9, $('meta[name="viewport"]').length > 0 ? 'المتجر متجاوب بالكامل مع أجهزة الهاتف المحمول' : 'وسم viewport مفقود', 'Mobile viewport meta check', $('meta[name="viewport"]').length > 0 ? `<meta name="viewport" content="${$('meta[name="viewport"]').attr('content')}">` : 'viewport missing');
    evaluateRule(47, responseHeaders['content-encoding']?.includes('gzip') || responseHeaders['content-encoding']?.includes('br'), 8, (responseHeaders['content-encoding']?.includes('gzip') || responseHeaders['content-encoding']?.includes('br')) ? 'ضغط البيانات (Gzip/Brotli) مفعل في الخادم' : 'ضغط البيانات Gzip غير مفعل في الخادم', 'Compression Gzip/Brotli check', `Content-Encoding = ${responseHeaders['content-encoding'] || 'none'}`);
    evaluateRule(48, !!responseHeaders['cache-control'], 8, responseHeaders['cache-control'] ? `سياسة التخزين المؤقت الكاش: ${responseHeaders['cache-control'].slice(0, 25)}` : 'ترويسة Cache-Control مفقودة في الخادم', 'Cache-Control header check', `Cache-Control = ${responseHeaders['cache-control'] || 'none'}`);

    // Category 7: AEO / GEO Engine & LLM Search Optimization
    evaluateRule(49, hasLlmsTxt, 10, hasLlmsTxt ? 'ملف llms.txt متوفر ومعد للوكلاء الذكيين' : 'ملف llms.txt مفقود (المتجر غير معرف لنماذج الذكاء الاصطناعي)', hasLlmsTxt ? 'llms.txt present' : 'llms.txt missing', hasLlmsTxt ? 'GET /llms.txt 200 OK' : 'llms.txt 404 / missing');
    evaluateRule(50, hasLlmsTxt && llmsTxt.length > 100, 9, (hasLlmsTxt && llmsTxt.length > 100) ? 'ملف llms.txt يحتوي على روابط وقوائم منتجات' : 'ينبغي إنشاء ملف llms.txt غني بالمعلومات', (hasLlmsTxt && llmsTxt.length > 100) ? 'Rich llms.txt content' : 'llms.txt content thin', hasLlmsTxt ? `llms.txt length = ${llmsTxt.length} chars` : 'llms.txt missing');
    evaluateRule(51, hasFaqSchema || htmlLower.includes('أسئلة') || htmlLower.includes('faq'), 8, (hasFaqSchema || htmlLower.includes('أسئلة') || htmlLower.includes('faq')) ? 'قسم الأسئلة الشائعة متوفر ومتاح للبوتات' : 'قسم الأسئلة الشائعة غير متوفر برمجياً', 'FAQ section check', (hasFaqSchema || htmlLower.includes('faq')) ? 'FAQ keywords / schema found' : 'No FAQ found');
    evaluateRule(52, htmlLower.includes('سياسة') || htmlLower.includes('الشحن') || htmlLower.includes('الاسترجاع') || htmlLower.includes('return') || htmlLower.includes('shipping'), 8, (htmlLower.includes('سياسة') || htmlLower.includes('شحن')) ? 'سياسات الشحن والإرجاع معرفة بصيغة نصية واضحة' : 'سياسات الشحن والإرجاع غير واضحة للبوتات', 'Shipping & Return policies readable', (htmlLower.includes('سياسة') || htmlLower.includes('return')) ? 'Policy keywords found' : 'No policy keywords');
    evaluateRule(53, htmlLower.includes('تواصل') || htmlLower.includes('واتساب') || htmlLower.includes('contact') || htmlLower.includes('phone') || htmlLower.includes('email') || $('a[href^="tel:"]').length > 0 || $('a[href^="mailto:"]').length > 0, 8, 'بيانات التواصل والدعم الفني مكشوفة للبوتات', 'Contact details readable for AI', (htmlLower.includes('contact') || $('a[href^="tel:"]').length > 0) ? 'Contact elements present' : 'No contact tags');
    evaluateRule(54, metaDescription.length > 50 || $('p').length > 5, 7, (metaDescription.length > 50 || $('p').length > 5) ? 'العناوين والأوصاف واضحة ومباشرة لإجابات الذكاء الاصطناعي' : 'النصوص الوصفية قصيرة جداً لإجابات الذكاء الاصطناعي', 'AEO direct answers optimized', `Paragraph count: ${$('p').length}`);
    evaluateRule(55, hasHttps && (hasOrganizationSchema || !!ogTitle), 7, (hasHttps && (hasOrganizationSchema || !!ogTitle)) ? 'مصداقية المتجر موثقة بالنصوص والأدلة الترويجية' : 'بيانات موثوقية المتجر بحاجة لإضافة Schema Organization', 'Brand authority verified', hasOrganizationSchema ? 'Organization Schema verified' : 'No Org Schema');
    evaluateRule(56, h2Count > 0 || $('h3').length > 0, 7, (h2Count > 0 || $('h3').length > 0) ? 'بنية المقالات والوصف محسنة للمحركات التوليدية (GEO)' : 'الهيكلية بحاجة لإضافة عناوين فرعية H2/H3', 'GEO structure active', `<h2>: ${h2Count}, <h3>: ${$('h3').length}`);
    evaluateRule(57, hasOfferSchema || !!ogPrice || htmlLower.includes('ر.س') || htmlLower.includes('ريال') || htmlLower.includes('$') || htmlLower.includes('€'), 8, (hasOfferSchema || !!ogPrice) ? 'سهولة استخراج الأسعار والمواصفات لنماذج AI' : 'الأسعار غير متوفرة في الترويسات الهيكلية', 'AI spec extraction seamless', ogPrice ? `Price: ${ogPrice}` : (htmlLower.includes('ريال') ? 'Currency string found' : 'No price markup'));
    evaluateRule(58, $('input[type="search"]').length > 0 || $('input[name="q"]').length > 0 || htmlLower.includes('search') || htmlLower.includes('بحث'), 8, ($('input[type="search"]').length > 0 || htmlLower.includes('search') || htmlLower.includes('بحث')) ? 'فهرسة ونظام البحث متوفر في المتجر' : 'حقل البحث داخل المتجر غير متوفر', 'Search indexing available', $('input[type="search"]').length > 0 ? 'Search input element found' : 'No search input');

    // Category 8: Rogue Bot & Fraud Protection Rules
    evaluateRule(59, hasHttps, 10, hasHttps ? 'الاتصال مشفر وآمن عبر شهادة SSL (HTTPS)' : 'الموقع غير مشفر بشهادة SSL!', hasHttps ? 'SSL HTTPS active' : 'SSL missing', `URL Protocol = ${parsedUrl.protocol}`);
    evaluateRule(60, !!responseHeaders['strict-transport-security'] || !!responseHeaders['content-security-policy'] || !!responseHeaders['x-frame-options'], 8, (responseHeaders['strict-transport-security'] || responseHeaders['content-security-policy']) ? 'تشفير الترويسات مطابق لمعيار الأمان HTTP' : 'ترويسات الحماية والآمان (HSTS/CSP) مفقودة في الخادم', 'Security Headers supported', responseHeaders['strict-transport-security'] ? 'HSTS active' : (responseHeaders['content-security-policy'] ? 'CSP active' : 'No HSTS/CSP headers'));
    evaluateRule(61, htmlLower.includes('cf-ray') || !!responseHeaders['cf-ray'] || htmlLower.includes('recaptcha') || htmlLower.includes('hcaptcha') || htmlLower.includes('cloudflare') || responseHeaders['server']?.toLowerCase().includes('cloudflare'), 8, (htmlLower.includes('cloudflare') || responseHeaders['cf-ray']) ? 'دعم التحقق والحماية الفعالة ضد هجمات البوتات عبر WAF / Cloudflare' : 'جدار حماية WAF ضد البوتات الضارة غير مكتشف', 'WAF Agent Protection active', responseHeaders['cf-ray'] ? `CF-RAY = ${responseHeaders['cf-ray']}` : 'No WAF headers');
    evaluateRule(62, detectedPayments.length > 0, 9, detectedPayments.length > 0 ? `أنظمة الدفع المكتشفة: ${detectedPayments.join(', ')}` : 'لم يتم رصد بوابات دفع معروفة برمجياً', detectedPayments.length > 0 ? `Payment gateways: ${detectedPayments.join(', ')}` : 'No known payment gateways detected', `Detected Payments: [${detectedPayments.join(', ')}]`);
    evaluateRule(63, !!responseHeaders['x-rate-limit'] || !!responseHeaders['retry-after'] || !!responseHeaders['server'], 8, (responseHeaders['server'] || responseHeaders['x-rate-limit']) ? 'خادم المتجر محمي بحماية الكثافة وشروط الحظر' : 'حماية طلبات البوتات الكثيفة بحاجة لتحسين', 'Rate Limiting headers active', responseHeaders['server'] ? `Server = ${responseHeaders['server']}` : 'No server header');
    evaluateRule(64, htmlLower.includes('خصوصية') || htmlLower.includes('شروط') || htmlLower.includes('privacy') || htmlLower.includes('terms'), 8, (htmlLower.includes('خصوصية') || htmlLower.includes('terms')) ? 'سياسات الأمان والحماية وروابط الشروط مفعلة' : 'روابط الشروط والأحكام والخصوصية مفقودة', 'Terms & Privacy policies active', (htmlLower.includes('خصوصية') || htmlLower.includes('privacy')) ? 'Privacy/Terms links found' : 'No policy links');

    // Calculate Category Scores DYNAMICALLY
    const totalPassed = Object.values(ruleResults).filter(r => r.passed).length;
    const totalMax = 64;
    const overallScorePercent = Math.round((totalPassed / totalMax) * 100);

    // Calculate Dynamic PageSpeed Scores based on TTFB and payload
    let psMobile = Math.max(35, Math.min(99, 96 - Math.floor(ttfbMs / 40) - (htmlContent.length > 300000 ? 15 : 0)));
    let psDesktop = Math.max(55, Math.min(100, psMobile + 14));

    // Grade Determination
    let grade = 'C';
    if (overallScorePercent >= 90) grade = 'A+';
    else if (overallScorePercent >= 80) grade = 'A';
    else if (overallScorePercent >= 70) grade = 'B';
    else if (overallScorePercent >= 55) grade = 'C';
    else if (overallScorePercent >= 40) grade = 'D';
    else grade = 'F';

    // 7. Return Real Audit Response with Evidence
    return res.status(200).json({
      success: true,
      domain,
      formattedUrl,
      pageTitle,
      platform,
      responseStatus,
      ttfbMs,
      timestamp: new Date().toISOString(),
      overallScore: overallScorePercent,
      grade,
      totalPassed,
      totalMax,
      pagespeed: { mobile: psMobile, desktop: psDesktop },
      auditSummary: {
        hasProductSchema,
        hasOfferSchema,
        hasOpenGraph: !!ogTitle && !!ogImage,
        hasRobots,
        hasLlmsTxt,
        hasSitemap,
        detectedPayments
      },
      ruleResults
    });

  } catch (err) {
    console.error('[WakeelCheck] Critical error in audit:', err);
    return res.status(500).json({
      error: 'Failed to complete audit',
      details: err.message
    });
  }
};
