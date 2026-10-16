# La Tambouille — version test

App web statique (`index.html`, `app.js`, `fonts/`) + fonctions serveur Vercel (`api/`).

- `api/scan.js` : lecture des factures par l'IA (clé Anthropic côté serveur).
- `api/data.js` : données de chaque testeur, enregistrées en ligne (Upstash Redis).
- `api/check.js` : vérification du code d'accès.

Variables d'environnement Vercel :
- `ANTHROPIC_API_KEY` : clé API Anthropic
- `ACCESS_CODES` : codes d'accès autorisés, séparés par des virgules (un par testeur)
- `KV_REST_API_URL` / `KV_REST_API_TOKEN` : ajoutées automatiquement par l'intégration Upstash
- `SCAN_MODEL` (facultatif) : modèle utilisé, `claude-sonnet-5-5` par défaut

Build : `./build.sh` (régénère `src/app.jsx` et `app.js`).
