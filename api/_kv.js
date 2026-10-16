// Upstash Redis (REST), branché par l'intégration Vercel → Storage → Upstash.
// Les noms des variables dépendent du préfixe choisi : on cherche *_REST_API_URL / *_REST_API_TOKEN.
function pick(suffix, exclude) {
  const env = process.env;
  const direct = env['KV' + suffix] || env['UPSTASH_REDIS' + suffix];
  if (direct) return direct;
  const key = Object.keys(env).find((k) => k.endsWith(suffix) && !(exclude && k.includes(exclude)));
  return key ? env[key] : undefined;
}
const URL_ = pick('_REST_API_URL') || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = pick('_REST_API_TOKEN', 'READ_ONLY') || process.env.UPSTASH_REDIS_REST_TOKEN;

export function kvReady() { return !!(URL_ && TOKEN); }

export async function kv(...command) {
  const r = await fetch(URL_, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(command),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error);
  return j.result;
}
