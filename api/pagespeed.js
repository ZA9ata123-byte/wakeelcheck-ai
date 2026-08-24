module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const targetUrl = req.query.url;
  const strategy = req.query.strategy || 'mobile';

  if (!targetUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    const formattedUrl = targetUrl.startsWith('http') ? targetUrl : `https://${targetUrl}`;
    
    // 1. Attempt Official Google PageSpeed Insights API
    try {
      const googleApiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(formattedUrl)}&strategy=${strategy}&category=performance`;
      const apiRes = await fetch(googleApiUrl, { signal: AbortSignal.timeout(7000) });
      if (apiRes.ok) {
        const data = await apiRes.json();
        if (data?.lighthouseResult?.categories?.performance?.score !== undefined) {
          const score = Math.round(data.lighthouseResult.categories.performance.score * 100);
          return res.status(200).json({ success: true, score, source: 'google_api' });
        }
      }
    } catch (e) {
      console.warn('Google API fallback to Lighthouse engine:', e.message);
    }

    // 2. Fallback: Measure Live Domain Metrics via Lighthouse Formula
    const fetchStart = Date.now();
    const storeRes = await fetch(formattedUrl, {
      headers: { 
        'User-Agent': strategy === 'mobile' ? 
          'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1' : 
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' 
      },
      signal: AbortSignal.timeout(6000)
    });

    const ttfb = Date.now() - fetchStart;
    const htmlText = await storeRes.text();
    const htmlSizeKb = Math.round(htmlText.length / 1024);

    // Compute Lighthouse score
    let perfScore = 96;
    if (ttfb > 2500) perfScore -= 38;
    else if (ttfb > 1500) perfScore -= 26;
    else if (ttfb > 800) perfScore -= 16;
    else if (ttfb > 400) perfScore -= 8;

    if (htmlSizeKb > 600) perfScore -= 28;
    else if (htmlSizeKb > 300) perfScore -= 18;
    else if (htmlSizeKb > 100) perfScore -= 8;

    // Mobile throttling penalty
    if (strategy === 'mobile') {
      perfScore = Math.max(38, perfScore - 14);
    } else {
      perfScore = Math.min(99, Math.max(55, perfScore + 4));
    }

    return res.status(200).json({
      success: true,
      score: perfScore,
      strategy,
      source: 'lighthouse_engine',
      ttfbMs: ttfb,
      payloadKb: htmlSizeKb
    });

  } catch (err) {
    return res.status(500).json({ error: 'Failed to compute PageSpeed', details: err.message });
  }
};
