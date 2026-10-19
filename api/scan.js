import { checkCode } from './_auth.js';

const MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5'];
const DEFAULT_MODEL = process.env.SCAN_MODEL || 'claude-sonnet-5-5';


export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST uniquement' });
  const who = checkCode(req);
  if (!who) return res.status(401).json({ error: 'Code invalide' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'Clé API non configurée sur le serveur' });

  const body = req.body || {};
  const content = body.messages?.[0]?.content;
  if (!Array.isArray(content) || content.length > 4) return res.status(400).json({ error: 'Requête invalide' });
  // Seuls une facture (image ou PDF) et le texte de consigne sont transmis.
  const allowed = content.every((b) => ['image', 'document', 'text'].includes(b?.type));
  if (!allowed) return res.status(400).json({ error: 'Contenu non autorisé' });

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELS.includes(body.model) ? body.model : DEFAULT_MODEL,
      max_tokens: 16000,
      messages: [{ role: 'user', content }],
    }),
  });
  const data = await upstream.json().catch(() => ({}));
  console.log(JSON.stringify({ tester: who, status: upstream.status, usage: data.usage || null }));
  if (!upstream.ok) {
    return res.status(upstream.status === 429 ? 429 : 502).json({ error: data?.error?.message || 'Erreur du service IA' });
  }
  res.status(200).json(data);
}
