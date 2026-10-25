import { neon } from '@neondatabase/serverless';

function send(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.end(JSON.stringify(payload));
}

function validVideos(value) {
  if (!value || !Array.isArray(value.videos)) return false;
  if (value.videos.length > 2000) return false;
  const ids = new Set();
  for (const v of value.videos) {
    if (!v || typeof v !== 'object') return false;
    if (typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id)) return false;
    ids.add(v.id);
    if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 300) return false;
    if (typeof v.description !== 'string' || v.description.length > 10000) return false;
    if (typeof v.name !== 'string' || v.name.length > 200) return false;
    if (typeof v.link !== 'string' || v.link.length > 2048) return false;
    let url;
    try { url = new URL(v.link); } catch { return false; }
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (typeof v.published !== 'boolean') return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'POST', 'OPTIONS'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, POST, OPTIONS');
    return send(res, 405, { error: 'Method not allowed.' });
  }
  if (req.method === 'OPTIONS') return send(res, 204, {});

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) return send(res, 500, { error: 'DATABASE_URL is not configured in Vercel.' });
  const sql = neon(databaseUrl);

  try {
    await sql`CREATE TABLE IF NOT EXISTS chicken_store (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      videos JSONB NOT NULL DEFAULT '{"videos": []}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    await sql`INSERT INTO chicken_store (id, videos) VALUES (1, '{"videos": []}'::jsonb) ON CONFLICT (id) DO NOTHING`;

    if (req.method === 'GET') {
      const rows = await sql`SELECT videos FROM chicken_store WHERE id = 1`;
      return send(res, 200, rows[0]?.videos ?? { videos: [] });
    }

    const adminKey = process.env.CHICKEN_ADMIN_KEY;
    if (!adminKey) return send(res, 500, { error: 'CHICKEN_ADMIN_KEY is not configured in Vercel.' });
    const providedKey = req.headers['x-chicken-admin-key'];
    if (typeof providedKey !== 'string' || providedKey.length !== adminKey.length || providedKey !== adminKey) {
      return send(res, 401, { error: 'Admin key is missing or incorrect.' });
    }

    const body = req.body;
    if (!validVideos(body)) return send(res, 400, { error: 'Invalid data. Expected { "videos": [...] } with valid unique IDs, titles, HTTP(S) links, and published flags.' });

    await sql`UPDATE chicken_store SET videos = ${JSON.stringify(body)}::jsonb, updated_at = NOW() WHERE id = 1`;
    return send(res, 200, { ok: true, count: body.videos.length });
  } catch (error) {
    console.error('Chicken videos API error:', error);
    return send(res, 500, { error: 'Server error while accessing the video database.' });
  }
}
