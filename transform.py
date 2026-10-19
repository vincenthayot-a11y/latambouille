#!/usr/bin/env python3
"""Builds the pilot (tester) version of La Tambouille from /home/claude/tamb/app.jsx."""
import re, sys

SRC = '/home/claude/tamb/app.jsx'
DST = '/home/claude/pilot/src/app.jsx'
s = open(SRC, encoding='utf-8').read()

def rep(old, new, count=1):
    global s
    n = s.count(old)
    if n != count:
        sys.exit(f'Expected {count} match(es), found {n}: {old[:80]!r}')
    s = s.replace(old, new)

# ── A. AI models : current lineup (the server enforces its own whitelist) ──
s = re.sub(r"const AI_MODELS = \[.*?\];\n\nconst DEFAULT_AI_MODEL = '[^']+';",
"""const AI_MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5 (recommandé)', description: 'Meilleur compromis qualité / prix pour lire les factures.' },
  { id: 'claude-haiku-5-5',  name: 'Haiku 5.5 (économique)',  description: 'Plus rapide et moins cher, pour des factures simples.' },
  { id: 'claude-opus-5-5',   name: 'Opus 5.5 (haut de gamme)', description: 'Le plus capable, plus cher.' },
];

const DEFAULT_AI_MODEL = 'claude-sonnet-5-5';""", s, count=1, flags=re.S)
assert "claude-sonnet-5-5" in s

# ── B. Invoice scan goes through our server relay ─────────────────────────
rep("""  // Step 1: read file as base64
  const base64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Lecture du fichier échouée'));
    reader.readAsDataURL(file);
  });

  // Step 2: build content block matching file type
  const sourceBlock = file.type.startsWith('image/')
    ? { type: 'image', source: { type: 'base64', media_type: file.type, data: base64 } }
    : { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
""", """  // Step 1-2: photos are resized/compressed (phone photos are often 5-10 Mo),
  // PDFs are sent as-is. Returns the Claude content block.
  const sourceBlock = await pilotFileToBlock(file);
""")
rep("""  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },""",
"""  const response = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-access-code': pilotGetCode() },""")
rep("""  if (!response.ok) {
    const errText = await response.text();
    throw new Error('HTTP ' + response.status + ' : ' + errText.slice(0, 200));
  }
""", """  if (!response.ok) {
    const errText = await response.text();
    if (response.status === 401) throw new Error("Code d'accès refusé. Rechargez la page et saisissez votre code.");
    if (response.status === 413) throw new Error('Fichier trop lourd. Essayez une photo plus légère ou un PDF de moins de 3 Mo.');
    if (response.status === 429) throw new Error('Trop de lectures en peu de temps, réessayez dans une minute.');
    let msg = errText.slice(0, 200);
    try { msg = JSON.parse(errText).error || msg; } catch (e) {}
    throw new Error('Lecture impossible (' + response.status + ') : ' + msg);
  }
""")

# ── C. Tabs : drop Équipement, Énergie, Ventes CLYO; dashboard needs sales ──
rep("""    { id: 'dashboard',  label: 'Tableau de bord',   icon: LayoutDashboard, locked: phase1Mode },""",
    """    ...(phase1Mode ? [] : [{ id: 'dashboard',  label: 'Tableau de bord',   icon: LayoutDashboard }]),""")
for line in ["    { id: 'equipment',  label: 'Équipement',        icon: Wrench            },\n",
             "    { id: 'energy',     label: 'Énergie',           icon: Zap               },\n",
             "    { id: 'sales',      label: 'Ventes CLYO',       icon: Upload,           locked: phase1Mode },\n"]:
    rep(line, '')
rep("items: ['articles', 'recipes', 'platsdujour', 'purchases', 'stocks', 'alerts', 'sales', 'energy', 'equipment'] }",
    "items: ['purchases', 'articles', 'recipes', 'platsdujour', 'stocks', 'alerts'] }")
rep("const [activeTab, setActiveTab] = useState('dashboard');",
    "const [activeTab, setActiveTab] = useState('purchases');")
for t in ['nav-equipment', 'nav-energy', 'nav-sales']:
    s = re.sub(r"\n      \{ type: 'action', id: '" + t + r"'[^\n]*", '', s, count=1)
s = re.sub(r"\n      \{ type: 'action', id: 'nav-dashboard'[^\n]*", '', s, count=1)
for t in ['nav-equipment', 'nav-energy', 'nav-sales', 'nav-dashboard']:
    assert t not in s, t

# ── D. Header : Drive sync button → Sauvegarde (export / restore) ─────────
rep("<SyncStatusIndicator syncState={driveSync} onClick={() => setShowSyncModal(true)} />",
    "<PilotBackupButton context={context} applyRemoteData={applyRemoteData} isMobile={isMobile} />")

# ── E. Rapport : restaurant name + only purchase costs ────────────────────
rep("""          Le Comptoir
        </div>""", """          {pilotRestaurantName()}
        </div>""")
rep("            Le Comptoir · du {formatShortDate", "            {pilotRestaurantName()} · du {formatShortDate")
rep("""          label="Coût d'exploitation total"
          value={formatEuro(operatingCosts.grandTotal)}
          accentColor={palette.wine}
          sub={`Achats ${formatEuro(totalMonth)} · Énergie ${formatEuro(operatingCosts.energy.curr)} · Équipement ${formatEuro(operatingCosts.equipmentTotal)}`}""",
"""          label="Achats de la période"
          value={formatEuro(totalMonth)}
          accentColor={palette.wine}
          sub={`${monthPurchases.length} facture${monthPurchases.length > 1 ? 's' : ''} · hors taxes`}""")
s, n = re.subn(r"\n          <div className=\"mc-card\" style=\{\{ padding: isMobile \? 14 : 20 \}\}>\n            <div style=\{\{[^\n]*\}\}>Énergie</div>.*?\n          </div>\n          <div className=\"mc-card\" style=\{\{ padding: isMobile \? 14 : 20 \}\}>\n            <div style=\{\{[^\n]*\}\}>Équipement</div>.*?\n          </div>(?=\n          <div className=\"mc-card\")", '', s, count=1, flags=re.S)
assert n == 1, 'report energy/equipment cards'

# ── F. Wording : no more CLYO for testers ─────────────────────────────────
s = s.replace('vos ventes CLYO', 'vos ventes').replace('Les seuils calculés automatiquement nécessitent vos ventes.', 'Les seuils calculés automatiquement nécessitent vos ventes.')

# ── F2. Achats : scan en bouton principal, état vide qui guide ───────────
rep("""      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 className="mc-display" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          Achats & Factures
        </h2>
        <div style={{ display: 'flex', gap: 8 }}>""", """      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, gap: 12, flexWrap: 'wrap' }}>
        <h2 className="mc-display" style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>
          Achats & Factures
        </h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>""")
rep("""          <button
            className="mc-btn mc-btn-ghost"
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            disabled={isScanning}
          >
            {isScanning ? (
              <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Analyse...</>
            ) : (
              <><Star size={14} /> Scanner 1 facture (IA)</>
            )}
          </button>
          <button
            className="mc-btn mc-btn-ghost"
            onClick={() => setShowBatchModal(true)}
          >
            <Layers size={14} /> Scanner plusieurs factures (IA)
          </button>
          <button
            className="mc-btn mc-btn-ghost"
            onClick={() => setShowImportClaudeModal(true)}
            title="Importer des factures depuis un JSON généré dans Claude.ai (gratuit, idéal pour les imports massifs)"
          >
            <Upload size={14} /> Import Claude (JSON)
          </button>
          <button
            className="mc-btn mc-btn-primary"
            onClick={() => setEditingPurchase({ items: [], date: new Date().toISOString().slice(0, 10), invoiceNumber: '' })}
          >
            <Plus size={14} /> Saisie manuelle
          </button>""", """          <button
            className="mc-btn mc-btn-ghost"
            onClick={() => setEditingPurchase({ items: [], date: new Date().toISOString().slice(0, 10), invoiceNumber: '' })}
          >
            <Plus size={14} /> Saisie manuelle
          </button>
          <button
            className="mc-btn mc-btn-ghost"
            onClick={() => setShowBatchModal(true)}
          >
            <Layers size={14} /> Plusieurs factures
          </button>
          <button
            className="mc-btn mc-btn-primary"
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            disabled={isScanning}
          >
            {isScanning ? (
              <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Lecture…</>
            ) : (
              <><Star size={14} /> Scanner une facture</>
            )}
          </button>""")
rep("""      <div style={{ marginBottom: 20 }}>
        <InfoBanner icon={RefreshCw} color={palette.wine}>
          <strong style={{ color: palette.wine }}>Matching article + variante :</strong>{' '}
          chaque libellé est rattaché à une <strong>variante précise</strong> d'un article.
          Les conditionnements et alias sont mémorisés sur la variante.
        </InfoBanner>
      </div>
""", """      {purchases.length === 0 && !isScanning && !scanResult && (
        <div className="mc-card" style={{ padding: '40px 24px', marginBottom: 20, textAlign: 'center' }}>
          <div style={{ fontFamily: 'Fraunces, serif', fontSize: 22, fontWeight: 600, color: palette.ink }}>
            Commencez par une facture fournisseur
          </div>
          <p style={{ fontSize: 14, color: palette.inkSoft, maxWidth: 460, margin: '10px auto 20px', lineHeight: 1.55 }}>
            Une photo ou un PDF suffit. La Tambouille lit le fournisseur, les produits, les quantités
            et les prix. Vous vérifiez, vous enregistrez, et votre catalogue se construit tout seul.
          </p>
          <button className="mc-btn mc-btn-primary" style={{ padding: '12px 20px', fontSize: 15 }}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}>
            <Star size={16} /> Scanner ma première facture
          </button>
        </div>
      )}
""")
rep("<strong style={{ color: palette.wine }}>Analyse en cours...</strong> Console (F12) pour le détail.",
    "<strong style={{ color: palette.wine }}>Lecture de la facture…</strong> Comptez 15 à 40 secondes.")

# ── F3. Ligne de facture lisible sur téléphone ───────────────────────────
rep("""  const masterUnit = matchedArticle ? matchedArticle.unit : item.masterUnit || 'kg';

  return (
    <div style={{ padding: 14, background: palette.paper, borderRadius: 8, marginBottom: 8 }}>""",
"""  const masterUnit = matchedArticle ? matchedArticle.unit : item.masterUnit || 'kg';
  const isMobile = useIsMobile(720);

  return (
    <div style={{ padding: 14, background: palette.paper, borderRadius: 8, marginBottom: 8 }}>""")
rep("""      {/* Article + variant selectors side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>""",
"""      {/* Article + variant selectors side-by-side */}
      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 8, marginBottom: 8 }}>""")
rep("""      <div style={{ display: 'grid', gridTemplateColumns: '1fr 24px 1fr 1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: palette.inkSoft, marginBottom: 4 }}>Qté brute (facture)</div>""",
"""      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 24px 1fr 1fr 1fr 32px', gap: 8, alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 11, color: palette.inkSoft, marginBottom: 4 }}>Qté brute (facture)</div>""")
rep("""        <div style={{ textAlign: 'center', paddingTop: 20 }}>
          <RefreshCw size={14} style={{ color: palette.amber }} />
        </div>
        <div>
          <div style={{ fontSize: 11, color: palette.amber, marginBottom: 4 }}>Qté convertie</div>""",
"""        {!isMobile && <div style={{ textAlign: 'center', paddingTop: 20 }}>
          <RefreshCw size={14} style={{ color: palette.amber }} />
        </div>}
        <div>
          <div style={{ fontSize: 11, color: palette.amber, marginBottom: 4 }}>Qté convertie</div>""")

rep("""        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label className="mc-label">Date</label>""",
"""        <div style={{ display: 'grid', gridTemplateColumns: (typeof window !== 'undefined' && window.innerWidth < 720) ? '1fr 1fr' : '1fr 2fr 1fr', gap: 12, marginBottom: 20 }}>
          <div>
            <label className="mc-label">Date</label>""")
rep("""            <input className="mc-input" style={{ width: 80 }} value={item.rawUnit} onChange={(e) => onUpdate(index, 'rawUnit', e.target.value)} />""",
"""            <input className="mc-input" style={{ width: isMobile ? 56 : 80 }} value={item.rawUnit} onChange={(e) => onUpdate(index, 'rawUnit', e.target.value)} />""")

# ── F4. Chaque enregistrement local déclenche l'enregistrement en ligne ──
rep("""    await storageAdapter.set(key, JSON.stringify(value));
  } catch (error) {""", """    await storageAdapter.set(key, JSON.stringify(value));
    if (typeof window !== 'undefined' && window.__pilotSave) window.__pilotSave(key);
  } catch (error) {""")

# ── H. Pilotage : Rapport + Économies (remplacent Rapport, Analyses, Simulateur) ──
rep("""    { id: 'analytics',  label: 'Analyses',          icon: TrendingUp        },
    { id: 'simulator',  label: 'Simulateur',        icon: Star              },""",
"""    { id: 'savings',    label: 'Économies',         icon: TrendingUp        },""")
rep("items: ['report', 'analytics', 'simulator'] }", "items: ['report', 'savings'] }")
rep("{activeTab === 'report' && <ReportView context={context} />}", "{activeTab === 'report' && <PilotReportView context={context} />}")
rep("{activeTab === 'analytics' && <AnalyticsView context={context} />}", "{activeTab === 'savings' && <PilotSavingsView context={context} />}")
rep("{activeTab === 'simulator' && <SimulatorView context={context} />}", "")
rep("""    alertsIndex,
    ...periodFilter,
  };""", """    alertsIndex,
    setActiveTab,
    ...periodFilter,
  };""")
s = re.sub(r"\n      \{ type: 'action', id: 'nav-simulator'[^\n]*", '', s, count=1)
s = re.sub(r"\{ type: 'action', id: 'nav-analytics'[^\n]*",
  "{ type: 'action', id: 'nav-savings',   label: 'Économies',           hint: 'Fournisseurs, références, prix', target: 'savings'    },", s, count=1)

# ── I. Alertes : prix anormaux sur factures, hausses, stock ; badge cohérent ──
rep("{activeTab === 'alerts' && <AlertsView context={context} />}", "{activeTab === 'alerts' && <PilotAlertsView context={context} />}")
rep("""  // will activate once CLYO sales are imported.
  const phase1Mode = sales.length === 0;
""", """  // will activate once CLYO sales are imported.
  const phase1Mode = sales.length === 0;
  const pilotBadgeAlerts = useMemo(() => {
    const g = pilotAlertGroups(purchases, articles, alertsIndex, alertSettings);
    return [...g.anomalies, ...g.trends, ...g.stock];
  }, [purchases, articles, alertsIndex, alertSettings]);
""")
rep("""          alertsIndex={alertsIndex}
          collapsed={sidebarCollapsed}""", """          alertsIndex={pilotBadgeAlerts}
          collapsed={sidebarCollapsed}""")

# ── J. Lecture en deux temps : Haiku, puis Sonnet si les contrôles échouent ──
rep("""  const chosenModel = await storageGet(STORAGE_KEYS.aiModel, DEFAULT_AI_MODEL);
  const scanPrompt = await storageGet(STORAGE_KEYS.scanPrompt, DEFAULT_SCAN_PROMPT);
  const response = await fetch('/api/scan', {""", """  const scanPrompt = await storageGet(STORAGE_KEYS.scanPrompt, DEFAULT_SCAN_PROMPT);
  const parsed = await pilotScanWithFallback(sourceBlock, scanPrompt);
  /* ancienne lecture directe, conservée pour référence :
  const response = await fetch('/api/scan', {""")
rep("""  const parsed = extractInvoiceJson(rawText);
  if (!parsed.items || !Array.isArray(parsed.items)) {
    throw new Error('Le JSON ne contient pas de tableau "items"');
  }
""", """  */
""")

# ── K. Un fournisseur déjà connu garde son nom d'origine ───────────────
rep("""    supplier: parsed.supplier || '',""", """    supplier: pilotMatchSupplier(parsed.supplier || ''),""")

# ── L. Fournisseur : liste des fournisseurs connus + mémorisation des corrections ──
rep("""    supplier: pilotMatchSupplier(parsed.supplier || ''),""", """    supplier: pilotMatchSupplier(parsed.supplier || ''),
    scannedSupplier: parsed.supplier || '',""")
rep("""    onSave({ ...form, total: computedTotal });""", """    if (initial.scannedSupplier) pilotRememberSupplierAlias(initial.scannedSupplier, form.supplier);
    const { scannedSupplier, ...clean } = form;
    onSave({ ...clean, total: computedTotal });""")
rep("""            <label className="mc-label">Fournisseur</label>
            <input className="mc-input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />""",
"""            <label className="mc-label">Fournisseur</label>
            <input className="mc-input" list="pilot-suppliers" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
            <datalist id="pilot-suppliers">
              {Object.keys(pilotKnownSuppliers()).sort().map((s) => <option key={s} value={s} />)}
            </datalist>""")

# ── M. « Tout enregistrer » : chaque facture du lot doit voir les précédentes ──
# (sinon setPurchases([...purchases, x]) en boucle ne garde que la dernière)
rep("""  const handleSave = useCallback(
    (data) => {
      let updatedArticles = [...articles];
""", """  const pilotArticlesRef = useRef(articles);
  const pilotPurchasesRef = useRef(purchases);
  pilotArticlesRef.current = articles;
  pilotPurchasesRef.current = purchases;
  const handleSave = useCallback(
    (data) => {
      const articles = pilotArticlesRef.current;
      const purchases = pilotPurchasesRef.current;
      let updatedArticles = [...articles];
""")
rep("""      setArticles(updatedArticles);

      const finalPurchase = { ...data, items: finalItems };
      if (data.id && purchases.find((p) => p.id === data.id)) {
        setPurchases(purchases.map((p) => (p.id === data.id ? finalPurchase : p)));
      } else {
        setPurchases([...purchases, { ...finalPurchase, id: finalPurchase.id || generateId('p') }]);
      }
""", """      pilotArticlesRef.current = updatedArticles;
      setArticles(updatedArticles);

      const { scannedSupplier, ...cleanData } = data;
      const finalPurchase = { ...cleanData, items: finalItems };
      const nextPurchases = (data.id && purchases.find((p) => p.id === data.id))
        ? purchases.map((p) => (p.id === data.id ? finalPurchase : p))
        : [...purchases, { ...finalPurchase, id: finalPurchase.id || generateId('p') }];
      pilotPurchasesRef.current = nextPurchases;
      setPurchases(nextPurchases);
""")

# ── N. Catégorie proposée par l'IA pour les nouveaux articles ──────────
rep("""      packagingDesc: item.packaging_description || '',""", """      packagingDesc: item.packaging_description || '',
      category: item.category || '',""")
rep("""          updatedArticles.push({
            id: newArticleId,
            name: item.productName,
            unit: item.masterUnit || 'kg',
            category: '',""", """          updatedArticles.push({
            id: newArticleId,
            name: item.productName,
            unit: item.masterUnit || 'kg',
            category: pilotValidCategory(item.category),""")

# ── O. Catalogue : le libellé exact de la facture est mémorisé sur l'article ──
rep("""          updatedArticles.push({
            id: newArticleId,
            name: item.productName,
            unit: item.masterUnit || 'kg',
            category: pilotValidCategory(item.category),
            variants: [
              {
                id: newVariantId,
                name: item.productName,
                aliases: [],""", """          updatedArticles.push({
            id: newArticleId,
            name: item.productName,
            unit: item.masterUnit || 'kg',
            category: pilotValidCategory(item.category),
            variants: [
              {
                id: newVariantId,
                name: item.productName,
                aliases: (item.label && item.label !== item.productName) ? [{ label: item.label, supplier: data.supplier || '' }] : [],""")
rep("""            if (
              variant.name !== item.productName &&
              !(variant.aliases || []).some((a) => a.label === item.productName)
            ) {
              const updatedVariant = {
                ...variant,
                aliases: [
                  ...(variant.aliases || []),
                  { label: item.productName, supplier: data.supplier || '' },
                ],
              };""", """            const newLabels = [item.productName, item.label].filter((l, i, arr) => l && arr.indexOf(l) === i &&
              l !== variant.name && !(variant.aliases || []).some((a) => a.label === l));
            if (newLabels.length) {
              const updatedVariant = {
                ...variant,
                aliases: [
                  ...(variant.aliases || []),
                  ...newLabels.map((l) => ({ label: l, supplier: data.supplier || '' })),
                ],
              };""")

# ── P. Même libellé de facture = même article (même au sein d'un lot) ──
rep("""        if (item.productName) {
          const match = findArticleByLabel(item.productName, updatedArticles);""", """        if (item.productName) {
          const match = pilotFindByExactLabel(item.label, updatedArticles) || findArticleByLabel(item.productName, updatedArticles);""")


# ── Q. Factures hors marchandises (carburant, garage, services…) ──────────
# Signalées à l'utilisateur ; si elles sont gardées, leurs lignes ne créent
# pas d'articles au catalogue et elles sortent du rapport des achats.
rep("""    scannedSupplier: parsed.supplier || '',
    invoiceNumber: parsed.invoice_number || '',""", """    scannedSupplier: parsed.supplier || '',
    kind: (parsed.invoice_type === 'autre' || parsed.kind === 'equipment' || parsed.kind === 'energy') ? 'other' : 'supply',
    invoiceNumber: parsed.invoice_number || '',""")
rep("""      const finalItems = data.items.map((item) => {
        // Case 1: already linked to an article AND existing variant""", """      const finalItems = data.kind === 'other'
        ? data.items.map((item) => ({ ...item, articleId: null, variantId: null }))
        : data.items.map((item) => {
        // Case 1: already linked to an article AND existing variant""")
rep("""    total: initial.total || 0,
    id: initial.id,
  });

  const [forceSave, setForceSave] = useState(false);""", """    total: initial.total || 0,
    id: initial.id,
    kind: initial.kind || 'supply',
  });

  const [forceSave, setForceSave] = useState(false);""")
rep("""        {duplicate && (
          <DuplicateWarning duplicate={duplicate} forceSave={forceSave} onForceSave={() => setForceSave(true)} />""", """        {form.kind === 'other' && (
          <PilotOtherInvoiceWarning
            onKeep={() => setForm({ ...form, kind: 'supply' })}
            onCancel={onClose} />
        )}

        {duplicate && (
          <DuplicateWarning duplicate={duplicate} forceSave={forceSave} onForceSave={() => setForceSave(true)} />""")
rep("""                  status: dup ? 'duplicate' : 'success',""", """                  status: dup ? 'duplicate' : (result.kind === 'other' ? 'other' : 'success'),""")
rep("""        i.id === itemId ? { ...i, status: 'success', duplicate: null } : i
      )
    );
  };""", """        i.id === itemId ? { ...i, status: i.result?.kind === 'other' ? 'other' : 'success', duplicate: null } : i
      )
    );
  };

  // Hors marchandises : l'utilisateur la garde quand même (sans catalogue)
  const handleKeepOther = (itemId) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, status: 'success' } : i)));
  };""")
rep("""    duplicate: items.filter((i) => i.status === 'duplicate').length,""", """    duplicate: items.filter((i) => i.status === 'duplicate').length,
    other: items.filter((i) => i.status === 'other').length,""")
rep("""  const processedCount = stats.success + stats.duplicate + stats.error""", """  const processedCount = stats.success + stats.duplicate + stats.other + stats.error""")
rep("""                  onForceDuplicate={() => handleForceDuplicate(item.id)}""", """                  onForceDuplicate={() => handleForceDuplicate(item.id)}
                  onKeepOther={() => handleKeepOther(item.id)}""")
rep("""function BatchScanItem({ item, articles, onRetry, onIgnore, onManualEdit, onForceDuplicate }) {""", """function BatchScanItem({ item, articles, onRetry, onIgnore, onManualEdit, onForceDuplicate, onKeepOther }) {""")
rep("""        return { icon: '⚠', color: palette.amber, bg: palette.amber + '15', label: 'Doublon' };""", """        return { icon: '⚠', color: palette.amber, bg: palette.amber + '15', label: 'Doublon' };
      case 'other':
        return { icon: '⚠', color: palette.amber, bg: palette.amber + '15', label: 'Hors marchandises' };""")
rep("""          {status === 'duplicate' && result && duplicate && (""", """          {status === 'other' && result && (
            <span style={{ fontSize: 12, color: palette.inkSoft }}>
              {result.supplier || '?'} · {formatShortDate(result.date, { withYear: true })} · {formatEuro(result.total)}
              {' — '}
              <em>pas un achat de marchandises</em>
            </span>
          )}
          {status === 'success' && result && result.kind === 'other' && (
            <span className="mc-pill" style={{ fontSize: 11 }}>hors catalogue</span>
          )}
          {status === 'duplicate' && result && duplicate && (""")
rep("""        {status === 'duplicate' && (
          <>
            <button
              className="mc-btn mc-btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={onManualEdit}
            >
              <Edit3 size={12} /> Voir
            </button>""", """        {status === 'other' && (
          <>
            <button
              className="mc-btn mc-btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={onManualEdit}
            >
              <Edit3 size={12} /> Voir
            </button>
            <button
              className="mc-btn mc-btn-amber"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={onKeepOther}
              title="Enregistrée dans les achats, sans créer d'articles au catalogue"
            >
              Enregistrer quand même
            </button>
            <button
              className="mc-btn mc-btn-danger"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={onIgnore}
            >
              Ignorer
            </button>
          </>
        )}
        {status === 'duplicate' && (
          <>
            <button
              className="mc-btn mc-btn-ghost"
              style={{ padding: '4px 10px', fontSize: 12 }}
              onClick={onManualEdit}
            >
              <Edit3 size={12} /> Voir
            </button>""")

# ── G. Mount the pilot shell (access code + onboarding) ───────────────────
rep("createRoot(_mc_rootEl).render(<LaTambouille />);", "createRoot(_mc_rootEl).render(<PilotRoot />);")

s += '\n' + open('/home/claude/pilot/pilot_shell.jsx', encoding='utf-8').read()
s += '\n' + open('/home/claude/pilot/pilot_views.jsx', encoding='utf-8').read()
open(DST, 'w', encoding='utf-8').write(s)
print('ok', len(s.splitlines()), 'lines')
