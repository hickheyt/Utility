exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const ip =
      event.headers['x-nf-client-connection-ip'] ||
      (event.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      'unknown';

    const body = JSON.parse(event.body || '{}');
    const ua = body.user_agent || '';
    const browser = parseBrowser(ua);
    const os = parseOS(ua);

    // Lookup ISP + location from IP (free, no key needed, supports IPv4 + IPv6)
    let isp = 'unknown', city = 'unknown', country = 'unknown';
    if (ip !== 'unknown') {
      try {
        const geo = await fetch(`http://ip-api.com/json/${ip}?fields=isp,city,country,status`);
        const geoData = await geo.json();
        if (geoData.status === 'success') {
          isp     = geoData.isp     || 'unknown';
          city    = geoData.city    || 'unknown';
          country = geoData.country || 'unknown';
        }
      } catch (_) {
        // Geo lookup failed silently — still log the visit
      }
    }

    const response = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/visits`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({
          ip,
          browser,
          os,
          isp,
          city,
          country,
          timezone:   body.timezone   || 'unknown',
          utc_time:   body.utc_time   || new Date().toISOString(),
          local_time: body.local_time || 'unknown',
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      console.error('Supabase error:', err);
      return { statusCode: 500, body: 'DB error' };
    }

    // Push notification via ntfy.sh
    try {
      await fetch('https://ntfy.sh/vis_alertz', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Title': '👀 New Portfolio Visitor',
          'Priority': 'default',
        },
        body: `🌍 ${city}, ${country}\n🌐 ${browser} | ${os}\n📡 ${isp}`,
      });
    } catch (_) {
      // Notification failure should never block the log
    }

    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, body: 'Internal error' };
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
