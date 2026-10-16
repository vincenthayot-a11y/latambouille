import { checkCode } from './_auth.js';
export default function handler(req, res) {
  if (!checkCode(req)) return res.status(401).json({ error: 'Code invalide' });
  res.status(200).json({ ok: true });
}
