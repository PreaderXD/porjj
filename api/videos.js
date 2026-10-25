import { neon } from '@neondatabase/serverless';

function send(res, status, payload) {
  res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return res.end(JSON.stringify(payload));
}

function toVideo(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    name: row.name ?? '',
    link: row.link,
    thumbnail: {
      type: row.thumbnail_type ?? 'initial',
      text: row.thumbnail_text ?? (row.title || '').slice(0, 1).toUpperCase(),
      shape: row.thumbnail_shape ?? 'circle'
    },
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    published: Boolean(row.published)
  };
}

function validVideos(value) {
  if (!value || !Array.isArray(value.videos) || value.videos.length > 2000) return false;
  const ids = new Set();
  for (const v of value.videos) {
    if (!v || typeof v !== 'object') return false;
    if (typeof v.id !== 'string' || !v.id.trim() || ids.has(v.id)) return false;
    ids.add(v.id);
    if (typeof v.title !== 'string' || !v.title.trim() || v.title.length > 300) return false;
    if (typeof (v.description ?? '') !== 'string' || (v.description ?? '').length > 10000) return false;
    if (typeof (v.name ?? '') !== 'string' || (v.name ?? '').length > 200) return false;
    if (typeof v.link !== 'string' || v.link.length > 2048) return false;
    let url;
    try { url = new URL(v.link); } catch { return false; }
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    if (typeof v.published !== 'boolean') return false;
  }
  return true;
}

export default async function handler(req, res) {
  if (!['GET', 'PUT', 'OPTIONS'].includes(req.method)) {
    res.setHeader('Allow', 'GET, PUT, OPTIONS');
    return send(res, 405, { error: 'Method not allowed.' });
  }
  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (!process.env.DATABASE_URL) {
    return send(res, 500, { error: 'DATABASE_URL is not configured in Vercel project environment variables.' });
  }
  const sql = neon(process.env.DATABASE_URL);

  try {
    // Safe to run repeatedly; creates the structured table if it is not there yet.
    await sql`CREATE TABLE IF NOT EXISTS chicken_videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      link TEXT NOT NULL,
      thumbnail_type TEXT NOT NULL DEFAULT 'initial',
      thumbnail_text TEXT NOT NULL DEFAULT '',
      thumbnail_shape TEXT NOT NULL DEFAULT 'circle',
      published BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;

    if (req.method === 'GET') {
      const configuredKey = process.env.CHICKEN_ADMIN_KEY;
      const suppliedKey = req.headers['x-chicken-admin-key'];
      const isAdmin = Boolean(configuredKey && typeof suppliedKey === 'string' && suppliedKey.length === configuredKey.length && suppliedKey === configuredKey);
      const rows = isAdmin
        ? await sql`SELECT * FROM chicken_videos ORDER BY created_at DESC`
        : await sql`SELECT * FROM chicken_videos WHERE published = TRUE ORDER BY created_at DESC`;
      return send(res, 200, { videos: rows.map(toVideo) });
    }

    const adminKey = process.env.CHICKEN_ADMIN_KEY;
    if (!adminKey) return send(res, 500, { error: 'CHICKEN_ADMIN_KEY is not configured in Vercel environment variables.' });
    const providedKey = req.headers['x-chicken-admin-key'];
    if (typeof providedKey !== 'string' || providedKey.length !== adminKey.length || providedKey !== adminKey) {
      return send(res, 401, { error: 'Admin key is missing or incorrect.' });
    }

    const body = req.body;
    if (!validVideos(body)) {
      return send(res, 400, { error: 'Invalid data. Expected {"videos": [...]} with unique IDs, titles, HTTP(S) links, and published flags.' });
    }

    // Replace the stored collection in a single database transaction.
    const queries = [sql`DELETE FROM chicken_videos`];
    for (const v of body.videos) {
      const thumb = v.thumbnail && typeof v.thumbnail === 'object' ? v.thumbnail : {};
      queries.push(sql`INSERT INTO chicken_videos
        (id, title, description, name, link, thumbnail_type, thumbnail_text, thumbnail_shape, published, created_at, updated_at)
        VALUES (
          ${v.id}, ${v.title}, ${v.description ?? ''}, ${v.name ?? ''}, ${v.link},
          ${thumb.type ?? 'initial'}, ${thumb.text ?? v.title.slice(0, 1).toUpperCase()}, ${thumb.shape ?? 'circle'},
          ${v.published}, ${v.createdAt ? new Date(v.createdAt) : new Date()}, ${v.updatedAt ? new Date(v.updatedAt) : new Date()}
        )`);
    }
    await sql.transaction(queries);
    return send(res, 200, { ok: true, count: body.videos.length });
  } catch (error) {
    console.error('Chicken videos API error:', error);
    return send(res, 500, { error: 'Database request failed. Check the Vercel function logs for details.' });
  }
}
