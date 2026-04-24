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
  if (/CriOS/.test(ua))          return 'Chrome (iOS)';   // Chrome on iPhone/iPad
  if (/FxiOS/.test(ua))          return 'Firefox (iOS)';  // Firefox on iPhone/iPad
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
