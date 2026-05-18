const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const errors = [];

  try {
    const ip =
      event.headers['x-nf-client-connection-ip'] ||
      (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      'unknown';

    const body = JSON.parse(event.body || '{}');
    const ua = body.user_agent || '';
    const browser = parseBrowser(ua);
    const os = parseOS(ua);

    let isp = 'unknown', city = 'unknown', country = 'unknown';
    if (ip !== 'unknown') {
      try {
        const geo = await fetch(`http://ip-api.com/json/${ip}?fields=isp,city,country,status`);
        if (!geo.ok) throw new Error(`ip-api responded ${geo.status}`);
        const geoData = await geo.json();
        if (geoData.status === 'success') {
          isp     = geoData.isp     || 'unknown';
          city    = geoData.city    || 'unknown';
          country = geoData.country || 'unknown';
        } else {
          errors.push('geo: bad status from ip-api');
        }
      } catch (err) {
        errors.push(`geo: ${err.message}`);
      }
    }

    const tag = body.tag
      ? ' | ' + body.tag.split('&').map(p => {
          const [k, v] = p.split('=');
          return `${decodeURIComponent(k)}: ${decodeURIComponent(v || '')}`;
        }).join(' | ')
      : '';

    const visitData = {
      ip, browser, os, isp, city, country,
      timezone:   body.timezone   || 'unknown',
      utc_time:   body.utc_time   || new Date().toISOString(),
      local_time: body.local_time || 'unknown',
    };

    // ntfy fires first, always, now with IP
    try {
      const ntfyRes = await fetch('https://ntfy.sh/vis_alertz', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Title': 'New Portfolio Visitor',
          'Priority': 'default',
        },
        body: `${city}, ${country} | ${browser} | ${os} | ${isp} | ${ip}${tag}`,
      });
      if (!ntfyRes.ok) throw new Error(`ntfy responded ${ntfyRes.status}`);
      console.log('ntfy ok');
    } catch (err) {
      errors.push(`ntfy: ${err.message}`);
      console.error('ntfy error:', err.message);
    }

    // Netlify Blobs - reliable, always on, no pausing bullshit
    try {
      const store = getStore('visits');
      const key = `visit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      await store.set(key, JSON.stringify(visitData));
      console.log('netlify blobs ok:', key);
    } catch (err) {
      errors.push(`blobs: ${err.message}`);
      console.error('netlify blobs error:', err.message);
    }

    // Supabase, best-effort
    try {
      const dbRes = await fetch(
        `${process.env.SUPABASE_URL}/rest/v1/visits`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'apikey': process.env.SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
            'Prefer': 'return=minimal',
          },
          body: JSON.stringify(visitData),
        }
      );
      if (!dbRes.ok) throw new Error(`supabase responded ${dbRes.status}: ${await dbRes.text()}`);
      console.log('supabase ok');
    } catch (err) {
      errors.push(`supabase: ${err.message}`);
      console.error('supabase error:', err.message);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        ...(errors.length > 0 && { warnings: errors }),
      }),
    };

  } catch (err) {
    console.error('function error:', err.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};

function parseBrowser(ua) {
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Edg\//.test(ua))          return 'Edge';
  if (/OPR\//.test(ua))          return 'Opera';
  if (/CriOS/.test(ua))          return 'Chrome (iOS)';
  if (/FxiOS/.test(ua))          return 'Firefox (iOS)';
  if (/Chrome\//.test(ua))       return 'Chrome';
  if (/Firefox\//.test(ua))      return 'Firefox';
  if (/Safari\//.test(ua))       return 'Safari';
  return 'Unknown';
}

function parseOS(ua) {
  if (/Windows NT 10/.test(ua))  return 'Windows 10/11';
  if (/Windows NT/.test(ua))     return 'Windows';
  if (/Android/.test(ua))        return 'Android';
  if (/iPhone/.test(ua))         return 'iOS (iPhone)';
  if (/iPad/.test(ua))           return 'iOS (iPad)';
  if (/Mac OS X/.test(ua))       return 'macOS';
  if (/Linux/.test(ua))          return 'Linux';
  return 'Unknown';
}
