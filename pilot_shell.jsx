// ═══════════════════════════════════════════════════════════════════════════
//   VERSION TEST : code d'accès, démarrage, sauvegarde, envoi des factures
// ═══════════════════════════════════════════════════════════════════════════

const PILOT_KEYS = { code: 'mc5:pilotCode', name: 'mc5:restaurantName', consent: 'mc5:pilotConsent' };

function pilotLS(key, value) {
  try {
    if (value === undefined) return window.localStorage.getItem(key) || '';
    window.localStorage.setItem(key, value);
  } catch (e) { return ''; }
  return value;
}
function pilotGetCode() { return pilotLS(PILOT_KEYS.code); }
function pilotRestaurantName() { return pilotLS(PILOT_KEYS.name) || 'Mon restaurant'; }

// Photos : redimensionnées à 2000 px max et recompressées en JPEG (une photo de
// téléphone fait souvent 5 à 10 Mo, trop lourd pour l'envoi). PDF : tels quels.
async function pilotFileToBlock(file) {
  const readAsBase64 = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = () => reject(new Error('Lecture du fichier échouée'));
    r.readAsDataURL(blob);
  });
  if (!file.type.startsWith('image/')) {
    if (file.size > 3.2 * 1024 * 1024) throw new Error('PDF trop lourd (plus de 3 Mo). Essayez une photo de la facture.');
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await readAsBase64(file) } };
  }
  let bitmap;
  try { bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch (e) { throw new Error("Format d'image non pris en charge. Prenez la photo en JPEG ou envoyez un PDF."); }
  const MAX = 2000;
  const scale = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await readAsBase64(blob) } };
}


// ─── Stockage en ligne : localStorage sert de cache, le serveur fait foi ──
const PILOT_SYNC_EXCLUDE = new Set(['mc5:pilotCode', 'mc5:pilotVersion', 'mc5:sidebarCollapsed']);
const pilotSync = {
  status: 'idle',            // idle | saving | saved | offline | error
  listeners: new Set(),
  timer: null,
  lastJson: null,
  set(st) { this.status = st; this.listeners.forEach((fn) => fn(st)); },
};

function pilotCollect() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('mc5:') && !PILOT_SYNC_EXCLUDE.has(k)) out[k] = localStorage.getItem(k);
    }
  } catch (e) {}
  return out;
}
function pilotVersion(v) {
  if (v === undefined) return Number(pilotLS('mc5:pilotVersion') || 0);
  pilotLS('mc5:pilotVersion', String(v));
  return v;
}
function pilotApply(data) {
  try {
    const keep = { [PILOT_KEYS.name]: pilotLS(PILOT_KEYS.name), [PILOT_KEYS.consent]: pilotLS(PILOT_KEYS.consent) };
    Object.keys(pilotCollect()).forEach((k) => localStorage.removeItem(k));
    Object.entries(data || {}).forEach(([k, v]) => { if (k.startsWith('mc5:') && !PILOT_SYNC_EXCLUDE.has(k)) localStorage.setItem(k, v); });
    Object.entries(keep).forEach(([k, v]) => { if (v && !localStorage.getItem(k)) localStorage.setItem(k, v); });
  } catch (e) {}
}
async function pilotApi(method, body, query = '') {
  return fetch('/api/data' + query, {
    method,
    headers: { 'content-type': 'application/json', 'x-access-code': pilotGetCode() },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Au démarrage : récupère les données du serveur (ou y envoie celles du navigateur
// si c'est la première fois). Renvoie false si le serveur est injoignable.
async function pilotPull() {
  const r = await pilotApi('GET');
  if (r.status === 503) return 'nostorage';
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  if (j.data) {
    pilotApply(j.data);
    if (!pilotLS(PILOT_KEYS.name) && j.data[PILOT_KEYS.name]) pilotLS(PILOT_KEYS.name, j.data[PILOT_KEYS.name]);
    pilotVersion(j.version);
    pilotSync.lastJson = JSON.stringify(pilotCollect());
  } else {
    pilotVersion(0);
    pilotSync.lastJson = null;
    await pilotPush();
  }
  window.__pilotSave = pilotSchedulePush;
  return 'ok';
}

async function pilotPush() {
  clearTimeout(pilotSync.timer);
  const data = pilotCollect();
  const json = JSON.stringify(data);
  if (json === pilotSync.lastJson) { pilotSync.set('saved'); return; }
  pilotSync.set('saving');
  try {
    const r = await pilotApi('PUT', { base: pilotVersion(), data });
    if (r.status === 409) {
      // Un autre appareil a enregistré entre-temps : on recharge sa version.
      await pilotPull();
      window.location.reload();
      return;
    }
    if (r.status === 503) { pilotSync.set('idle'); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    pilotVersion(j.version);
    pilotSync.lastJson = json;
    pilotSync.set('saved');
  } catch (e) {
    pilotSync.set('offline');
    pilotSync.timer = setTimeout(pilotPush, 15000);
  }
}

function pilotSchedulePush() {
  clearTimeout(pilotSync.timer);
  pilotSync.set('saving');
  pilotSync.timer = setTimeout(pilotPush, 1500);
}

// Retour sur l'onglet : si un autre appareil a enregistré, on recharge.
async function pilotCheckRemote() {
  if (pilotSync.status === 'saving' || document.visibilityState !== 'visible') return;
  try {
    const r = await pilotApi('GET', null, '?meta=1');
    if (!r.ok) return;
    const j = await r.json();
    if (j.version > pilotVersion() && JSON.stringify(pilotCollect()) === pilotSync.lastJson) {
      await pilotPull();
      window.location.reload();
    }
  } catch (e) {}
}

function usePilotSyncStatus() {
  const [st, setSt] = useState(pilotSync.status);
  useEffect(() => { pilotSync.listeners.add(setSt); return () => pilotSync.listeners.delete(setSt); }, []);
  return st;
}

// ─── Bouton « Sauvegarde » du bandeau (remplace la synchro Drive) ─────────
function PilotBackupButton({ context, applyRemoteData, isMobile }) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef(null);
  const syncStatus = usePilotSyncStatus();
  const syncLabel = { saving: 'Enregistrement…', saved: 'Enregistré', offline: 'Hors ligne', idle: 'Sauvegarde', error: 'Erreur' }[syncStatus] || 'Sauvegarde';
  const syncColor = syncStatus === 'offline' || syncStatus === 'error' ? palette.wine : syncStatus === 'saved' ? palette.sage : palette.inkSoft;

  const restore = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data.articles) || !Array.isArray(data.purchases)) throw new Error('format');
        if (!window.confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
        applyRemoteData(data);
        mcToast.success('Sauvegarde restaurée');
        setOpen(false);
      } catch (e) {
        mcToast.error("Ce fichier n'est pas une sauvegarde La Tambouille");
      }
    };
    reader.readAsText(file);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Télécharger ou restaurer vos données"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderRadius: 6,
          border: `1px solid ${palette.rule}`, background: 'transparent', cursor: 'pointer',
          fontFamily: 'DM Sans, sans-serif', fontSize: 12, color: palette.inkSoft,
        }}
      >
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: syncColor, display: 'inline-block' }} />
        {!isMobile && <span>{syncLabel}</span>}
      </button>
      {open && createPortal(
        <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(26,22,18,0.45)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} className="mc-card" style={{ background: palette.cream, padding: 24, maxWidth: 420, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="mc-display" style={{ margin: 0, fontSize: 20 }}>Vos données</h3>
              <button onClick={() => setOpen(false)} aria-label="Fermer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: palette.inkSoft }}><X size={18} /></button>
            </div>
            <p style={{ fontSize: 13, color: palette.inkSoft, lineHeight: 1.5, margin: '0 0 16px' }}>
              Vos données sont enregistrées automatiquement en ligne. Connectez-vous avec le même
              code sur un autre appareil pour les retrouver. Vous pouvez aussi télécharger une copie.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="mc-btn mc-btn-primary" style={{ justifyContent: 'center' }} onClick={() => exportFullBackup(context)}>
                <Download size={14} /> Télécharger ma sauvegarde
              </button>
              <button className="mc-btn mc-btn-ghost" style={{ justifyContent: 'center' }} onClick={() => inputRef.current && inputRef.current.click()}>
                <Upload size={14} /> Restaurer une sauvegarde
              </button>
              <input ref={inputRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
                onChange={(e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ''; }} />
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

// ─── Écran d'entrée : code d'accès + nom du restaurant + mention IA ──────
function PilotRoot() {
  const [ready, setReady] = useState(() => !!(pilotGetCode() && pilotLS(PILOT_KEYS.name) && pilotLS(PILOT_KEYS.consent)));
  const [code, setCode] = useState(pilotGetCode());
  const [name, setName] = useState(pilotLS(PILOT_KEYS.name));
  const [consent, setConsent] = useState(!!pilotLS(PILOT_KEYS.consent));
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    pilotPull()
      .then(() => { if (alive) setLoaded(true); })
      .catch(() => { if (alive) setLoadError('Impossible de récupérer vos données en ligne. Vérifiez votre connexion internet.'); });
    const onVis = () => pilotCheckRemote();
    document.addEventListener('visibilitychange', onVis);
    const poll = setInterval(pilotCheckRemote, 60000);
    return () => { alive = false; document.removeEventListener('visibilitychange', onVis); clearInterval(poll); };
  }, [ready]);

  if (ready && loaded) return <LaTambouille />;
  if (ready) {
    return (
      <div className="mc-app" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, textAlign: 'center' }}>
        <style>{globalStyles}</style>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 28, fontWeight: 700, color: palette.wine }}>La Tambouille</div>
        {loadError
          ? <><div style={{ color: palette.inkSoft, fontSize: 14, maxWidth: 360 }}>{loadError}</div>
              <button className="mc-btn mc-btn-primary" onClick={() => window.location.reload()}>Réessayer</button></>
          : <Loader2 size={28} style={{ color: palette.wine, animation: 'spin 1s linear infinite' }} />}
      </div>
    );
  }

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!code.trim() || !name.trim()) { setError('Renseignez votre code et le nom de votre restaurant.'); return; }
    if (!consent) { setError('Cochez la case pour continuer.'); return; }
    setChecking(true);
    try {
      const r = await fetch('/api/check', { headers: { 'x-access-code': code.trim() } });
      if (r.status === 401) { setError("Ce code d'accès n'est pas valide."); return; }
      if (!r.ok) { setError('Le service ne répond pas, réessayez dans un instant.'); return; }
      pilotLS(PILOT_KEYS.code, code.trim());
      pilotLS(PILOT_KEYS.name, name.trim());
      pilotLS(PILOT_KEYS.consent, new Date().toISOString());
      setReady(true);
    } catch (err) {
      setError('Connexion impossible. Vérifiez votre accès internet.');
    } finally {
      setChecking(false);
    }
  };

  const field = { width: '100%', padding: '11px 12px', border: `1px solid ${palette.rule}`, borderRadius: 6, fontSize: 15, fontFamily: 'DM Sans, sans-serif', background: '#fff', boxSizing: 'border-box' };
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: palette.inkSoft, margin: '0 0 6px' };

  return (
    <div className="mc-app" style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: palette.cream }}>
      <style>{globalStyles}</style>
      <form onSubmit={submit} className="mc-card" style={{ width: '100%', maxWidth: 440, padding: 28, background: '#fff' }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 30, fontWeight: 700, color: palette.wine }}>La Tambouille</div>
        <div style={{ fontSize: 14, color: palette.inkSoft, margin: '4px 0 24px' }}>Vos coûts matière, enfin sous contrôle. <span style={{ whiteSpace: 'nowrap' }}>· Version test</span></div>

        <label style={label} htmlFor="pilot-code">Code d'accès</label>
        <input id="pilot-code" style={field} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" />

        <label style={{ ...label, marginTop: 16 }} htmlFor="pilot-name">Nom de votre restaurant</label>
        <input id="pilot-name" style={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex. : Chez Paulette" />

        <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 18, fontSize: 13, color: palette.inkSoft, lineHeight: 1.45, cursor: 'pointer' }}>
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} style={{ marginTop: 3 }} />
          <span>
            J'accepte que mes données soient enregistrées en ligne pour la durée du test, et que les
            factures que je scanne soient envoyées à un service d'intelligence artificielle (Anthropic)
            uniquement pour être lues.
          </span>
        </label>

        {error && <div style={{ marginTop: 14, fontSize: 13, color: palette.wine }}>{error}</div>}

        <button type="submit" className="mc-btn mc-btn-primary" disabled={checking} style={{ width: '100%', justifyContent: 'center', marginTop: 20, padding: '12px 16px', fontSize: 15 }}>
          {checking ? 'Vérification…' : 'Commencer'}
        </button>
        <div style={{ fontSize: 12, color: palette.inkSoft, marginTop: 14, textAlign: 'center' }}>
          Première étape ensuite : prenez une facture fournisseur en photo.
        </div>
      </form>
    </div>
  );
}

// ─── Lecture des factures : Haiku d'abord, Sonnet en renfort ──────────────
// Haiku est ~13× moins cher. Ses réponses passent des contrôles de cohérence ;
// au moindre doute, la facture est relue par Sonnet.
const PILOT_FAST_MODEL = 'claude-haiku-5-5';
const PILOT_SAFE_MODEL = 'claude-sonnet-5-5';

class PilotHardError extends Error {}

// Donne à l'IA la liste des fournisseurs déjà enregistrés, pour qu'elle réutilise
// le même nom (utile surtout pour les factures manuscrites, lues différemment à chaque fois).
function pilotCategories() {
  try { const u = JSON.parse(localStorage.getItem('mc5:userSettings') || 'null'); if (u && Array.isArray(u.articleCategories) && u.articleCategories.length) return u.articleCategories; } catch (e) {}
  return ARTICLE_CATEGORIES;
}
function pilotValidCategory(c) {
  const list = pilotCategories();
  return list.includes(c) ? c : (list.includes('À trier') ? 'À trier' : '');
}

function pilotSupplierHint() {
  const counts = pilotKnownSuppliers();
  const names = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).slice(0, 80);
  const base = "\n\nNOM DU FOURNISSEUR : donne le nom commercial seul, sans adresse, sans ville et sans forme juridique (SARL, SAS…)." +
    "\nCATÉGORIE : pour chaque ligne, ajoute un champ \"category\" choisi exactement dans cette liste : " +
    pilotCategories().filter((c) => c !== 'À trier').map((c) => '« ' + c + ' »').join(', ') + ".";
  if (!names.length) return base;
  return base + "\nFournisseurs déjà enregistrés par ce restaurant : " + names.map((n) => '« ' + n + ' »').join(', ') +
    ".\nSi cette facture vient manifestement de l'un d'eux (même nom malgré une écriture ou une orthographe différente, même adresse), " +
    "mets exactement ce nom dans \"supplier\". En cas de doute, garde le nom lu sur la facture.";
}

async function pilotScanOnce(model, sourceBlock, scanPrompt) {
  const response = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-code': pilotGetCode() },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: [sourceBlock, { type: 'text', text: scanPrompt + pilotSupplierHint() }] }] }),
  });
  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401) throw new PilotHardError("Code d'accès refusé. Rechargez la page et saisissez votre code.");
    if (response.status === 413) throw new PilotHardError('Fichier trop lourd. Essayez une photo plus légère ou un PDF de moins de 3 Mo.');
    if (response.status === 429) throw new PilotHardError('Trop de lectures en peu de temps, réessayez dans une minute.');
    let msg = errText.slice(0, 200);
    try { msg = JSON.parse(errText).error || msg; } catch (e) {}
    throw new Error('Lecture impossible (' + response.status + ') : ' + msg);
  }
  const data = await response.json();
  if (data.stop_reason === 'max_tokens') throw new Error('Réponse incomplète');
  const textBlock = data.content?.find((c) => c.type === 'text');
  if (!textBlock || !textBlock.text) throw new Error("Le modèle n'a renvoyé aucun texte");
  const parsed = extractInvoiceJson(textBlock.text);
  if (!parsed.items || !Array.isArray(parsed.items)) throw new Error('Aucune ligne lue');
  return parsed;
}

// Contrôles de cohérence. Renvoie la liste des problèmes (vide = lecture fiable).
function pilotCheckInvoice(inv) {
  const pb = [];
  const items = inv.items || [];
  const n = (x) => (typeof x === 'number' && isFinite(x) ? x : Number(String(x ?? '').replace(',', '.')) || 0);
  if (!items.length) pb.push('aucune ligne');
  if (!String(inv.supplier || '').trim()) pb.push('fournisseur manquant');
  const d = inv.date ? new Date(inv.date + 'T12:00:00') : null;
  const now = new Date();
  if (d && isNaN(d)) pb.push('date illisible');
  else if (d && (d - now > 7 * 86400000 || now - d > 3 * 365 * 86400000)) pb.push('date improbable');
  // 1. Somme des lignes = total HT
  const sum = items.reduce((s, it) => s + n(it.total_ht), 0);
  const ht = n(inv.total_ht);
  if (ht > 0 && Math.abs(sum - ht) > Math.max(0.05, ht * 0.005)) pb.push(`lignes ${sum.toFixed(2)} ≠ total ${ht.toFixed(2)}`);
  for (const it of items) {
    const label = String(it.raw_label || it.product_name || '');
    const total = n(it.total_ht), qty = n(it.converted_qty), price = n(it.price_per_master_unit);
    // 2. Quantité × prix = montant de la ligne
    if (qty > 0 && price > 0 && Math.abs(qty * price - total) > Math.max(0.1, Math.abs(total) * 0.03)) pb.push(`ligne incohérente : ${label}`);
    // 3. Un volume ou un poids dans le libellé doit donner des L ou des kg
    const unit = String(it.master_unit || '').toLowerCase();
    // (« SL » = « 5L » mal lu, erreur fréquente sur les photos)
    const consumable = /\b(SACS? POUBELLE|SACS? CONGEL\w*|GOBELETS?|GANTS?|BARQUETTE|FILM|ALU|ALUMINIUM|SERVIETTE|PAILLE|TABLIER|POUBELLE|ASSIETTE|COUVERCLE|POT\s+CARTON|BOITE\s+PIZZA|ESSUIE|PAPIER|DETERGENT|LESSIVE|JAVEL|LIQUIDE\s+VAISSELLE)\b/i.test(label);
    if (!consumable && /(\d\s*(l|cl|ml|kg|g)|\bSL)\b/i.test(label) && /pi[eè]ce|^u$|unit/.test(unit)) pb.push(`unité à vérifier : ${label}`);
  }
  return pb;
}

async function pilotScanWithFallback(sourceBlock, scanPrompt) {
  let first = null, problems = [];
  try {
    first = await pilotScanOnce(PILOT_FAST_MODEL, sourceBlock, scanPrompt);
    problems = pilotCheckInvoice(first);
  } catch (e) {
    if (e instanceof PilotHardError) throw e;
    problems = [e.message];
  }
  if (!problems.length) return first;
  console.log('[Scan] relecture par Sonnet :', problems);
  const second = await pilotScanOnce(PILOT_SAFE_MODEL, sourceBlock, scanPrompt);
  const left = pilotCheckInvoice(second);
  mcToast.success(left.length
    ? 'Facture difficile : relue deux fois, vérifiez les lignes signalées'
    : 'Facture difficile : lecture vérifiée deux fois');
  return second;
}

// ─── Fournisseurs : rattacher un nom lu à un fournisseur déjà connu ───────
// « SOFRIMA RESTAURATION » et « SOFRIMA », « CARAIBEPRICE » et « CARAIBE PRICE »,
// « SN SOPROGLACES » et « SOPROGLACES » désignent le même fournisseur.
const PILOT_LEGAL_WORDS = new Set(['SARL', 'SAS', 'SASU', 'SA', 'SN', 'SNC', 'EURL', 'SCI', 'STE', 'SOCIETE', 'ETS', 'ETABLISSEMENTS', 'ETABLISSEMENT', 'CIE', 'ET', 'LES', 'LE', 'LA', 'DE', 'DU', 'DES']);

// Mots trop courants pour identifier un fournisseur à eux seuls.
const PILOT_GENERIC_WORDS = new Set(['BOUCHERIE', 'EPICERIE', 'POISSONNERIE', 'BOULANGERIE', 'PATISSERIE', 'MARCHE', 'PRIMEUR', 'PRIMEURS',
  'RESTAURATION', 'DISTRIBUTION', 'BOISSONS', 'MAREE', 'FERME', 'CAVE', 'SUPERMARCHE', 'CARREFOUR', 'LEADERPRICE', 'HYPER', 'SUPER', 'GROS']);

function pilotSupplierKey(name) {
  const words = String(name || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\./g, '').replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
  const kept = words.filter((w) => !PILOT_LEGAL_WORDS.has(w));
  return (kept.length ? kept : words);
}

function pilotSameSupplier(a, b) {
  const ta = pilotSupplierKey(a), tb = pilotSupplierKey(b);
  if (!ta.length || !tb.length) return false;
  const ca = ta.join(''), cb = tb.join('');
  if (ca === cb) return true;                                   // CARAIBEPRICE = CARAIBE PRICE
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (short.length >= 5 && long.startsWith(short) && !PILOT_GENERIC_WORDS.has(short)) return true;  // SOFRIMA ⊂ SOFRIMA RESTAURATION
  // Petite faute de lecture sur un nom long (1 lettre sur 8 ou plus)
  if (Math.min(ca.length, cb.length) >= 8 && pilotEditDistance(ca, cb) <= 1) return true;
  return false;
}

function pilotEditDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Corrections faites par l'utilisateur : « nom lu » → « vrai fournisseur ».
const PILOT_ALIAS_KEY = 'mc5:supplierAliases';
function pilotAliases() { try { return JSON.parse(localStorage.getItem(PILOT_ALIAS_KEY) || '{}'); } catch (e) { return {}; } }
function pilotRememberSupplierAlias(readName, finalName) {
  const k = pilotSupplierKey(readName).join('');
  if (!k || !String(finalName || '').trim() || pilotSupplierKey(finalName).join('') === k) return;
  const a = pilotAliases(); a[k] = finalName.trim();
  try { localStorage.setItem(PILOT_ALIAS_KEY, JSON.stringify(a)); } catch (e) {}
  if (window.__pilotSave) window.__pilotSave(PILOT_ALIAS_KEY);
}
function pilotKnownSuppliers() {
  let purchases = [];
  try { purchases = JSON.parse(localStorage.getItem('mc5:purchases') || '[]'); } catch (e) {}
  const counts = {};
  for (const p of purchases) { const s = (p.supplier || '').trim(); if (s) counts[s] = (counts[s] || 0) + 1; }
  for (const s of (window.__pilotSeenSuppliers || [])) if (!counts[s]) counts[s] = 0.5;
  return counts;
}

// Renvoie le nom du fournisseur déjà enregistré (le plus utilisé) s'il correspond.
function pilotMatchSupplier(name) {
  if (!name) return name;
  const alias = pilotAliases()[pilotSupplierKey(name).join('')];
  if (alias) return alias;
  // Fournisseurs lus pendant cette session mais pas encore enregistrés
  // (scan par lot : la 2e facture SOPROGLACES doit reprendre le nom de la 1re).
  window.__pilotSeenSuppliers = window.__pilotSeenSuppliers || [];
  let purchases = [];
  try { purchases = JSON.parse(localStorage.getItem('mc5:purchases') || '[]'); } catch (e) {}
  const counts = {};
  for (const p of purchases) { const s = (p.supplier || '').trim(); if (s) counts[s] = (counts[s] || 0) + 1; }
  for (const s of window.__pilotSeenSuppliers) if (!counts[s]) counts[s] = 0.5;
  const candidates = Object.keys(counts).filter((s) => pilotSameSupplier(s, name)).sort((x, y) => counts[y] - counts[x]);
  const result = candidates[0] || name;
  if (!window.__pilotSeenSuppliers.includes(result)) window.__pilotSeenSuppliers.push(result);
  return result;
}
