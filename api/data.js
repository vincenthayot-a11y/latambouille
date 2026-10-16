import { checkCode } from './_auth.js';
import { kv, kvReady } from './_kv.js';

// Données d'un testeur, rattachées à son code d'accès.
// GET  → { version, updatedAt, data }   (data = null s'il n'a encore rien enregistré)
// GET ?meta=1 → { version, updatedAt }
// PUT  { base, data } → { version } ; 409 si un autre appareil a enregistré entre-temps.
export default async function handler(req, res) {
  const code = checkCode(req);
  if (!code) return res.status(401).json({ error: 'Code invalide' });
  if (!kvReady()) return res.status(503).json({ error: 'Stockage non configuré' });
  const key = `tamb:data:${code}`;

  try {
    const raw = await kv('GET', key);
    const current = raw ? JSON.parse(raw) : { version: 0, updatedAt: null, data: null };

    if (req.method === 'GET') {
      if (req.query.meta) return res.status(200).json({ version: current.version, updatedAt: current.updatedAt });
      return res.status(200).json(current);
    }

    if (req.method === 'PUT') {
      const { base, data } = req.body || {};
      if (!data || typeof data !== 'object') return res.status(400).json({ error: 'Données manquantes' });
      if (Number(base) !== current.version) {
        return res.status(409).json({ error: 'Modifié sur un autre appareil', version: current.version });
      }
      // Filet de sécurité : une copie par jour de l'état précédent, gardée 30 jours.
      if (raw) {
        const day = new Date().toISOString().slice(0, 10);
        await kv('SET', `tamb:snap:${code}:${day}`, raw, 'NX', 'EX', 60 * 60 * 24 * 30);
      }
      const next = { version: current.version + 1, updatedAt: new Date().toISOString(), data };
      await kv('SET', key, JSON.stringify(next));
      return res.status(200).json({ version: next.version, updatedAt: next.updatedAt });
    }

    res.status(405).json({ error: 'Méthode non autorisée' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Erreur de stockage' });
  }
}
