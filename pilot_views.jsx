// ═══════════════════════════════════════════════════════════════════════════
//   PILOTAGE (version test) : Rapport + Économies
// ═══════════════════════════════════════════════════════════════════════════
// Une seule période pour tout : celle du sélecteur en haut de l'écran.

function pilotIsoDay(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Période courante + période précédente de même durée.
function usePilotPeriods(purchases, dateFrom, dateTo) {
  return useMemo(() => {
    const today = pilotIsoDay(new Date());
    const dates = purchases.map((p) => p.date).filter(Boolean).sort();
    const from = dateFrom || dates[0] || today;
    const to = dateTo || today;
    const inCur = (d) => d && d >= from && d <= to;
    const cur = purchases.filter((p) => inCur(p.date));
    let prev = [];
    let prevFrom = null, prevTo = null;
    if (dateFrom) {
      const f = new Date(from + 'T12:00:00'), t = new Date(to + 'T12:00:00');
      const days = Math.round((t - f) / 86400000) + 1;
      const pt = new Date(f); pt.setDate(pt.getDate() - 1);
      const pf = new Date(pt); pf.setDate(pf.getDate() - (days - 1));
      prevFrom = pilotIsoDay(pf); prevTo = pilotIsoDay(pt);
      prev = purchases.filter((p) => p.date && p.date >= prevFrom && p.date <= prevTo);
      // Pas de comparaison si la période précédente est quasi vide (début d'utilisation).
      if (prev.length < Math.max(2, cur.length * 0.3)) prev = [];
    }
    return { from, to, cur, prev, prevFrom, prevTo };
  }, [purchases, dateFrom, dateTo]);
}

// Prix moyen pondéré par article sur une liste de factures.
function pilotAvgPrices(list) {
  const map = {};
  for (const p of list) for (const it of (p.items || [])) {
    if (!it.articleId || !(it.pricePerMasterUnit > 0) || !(it.convertedQty > 0)) continue;
    const m = (map[it.articleId] = map[it.articleId] || { v: 0, q: 0 });
    m.v += it.pricePerMasterUnit * it.convertedQty; m.q += it.convertedQty;
  }
  const out = {};
  for (const [id, m] of Object.entries(map)) out[id] = { avg: m.v / m.q, qty: m.q };
  return out;
}

function pilotPriceIncreases(cur, prev, articles, minPct = 3) {
  const a = pilotAvgPrices(cur), b = pilotAvgPrices(prev);
  const rows = [];
  for (const [id, c] of Object.entries(a)) {
    const p = b[id];
    if (!p || !(p.avg > 0)) continue;
    const pct = ((c.avg - p.avg) / p.avg) * 100;
    if (pct < minPct) continue;
    const article = articles.find((x) => x.id === id);
    if (article) rows.push({ article, pct, cur: c.avg, prev: p.avg, extra: (c.avg - p.avg) * c.qty });
  }
  return rows.sort((x, y) => y.extra - x.extra);
}

// Même article acheté chez plusieurs fournisseurs : écart avec le moins cher.
function pilotSupplierSavings(list, articles) {
  const by = {};
  for (const p of list) {
    const sup = (p.supplier || '').trim() || 'Fournisseur inconnu';
    for (const it of (p.items || [])) {
      if (!it.articleId || !(it.pricePerMasterUnit > 0) || !(it.convertedQty > 0)) continue;
      const a = (by[it.articleId] = by[it.articleId] || {});
      const s = (a[sup] = a[sup] || { v: 0, q: 0 });
      s.v += it.pricePerMasterUnit * it.convertedQty; s.q += it.convertedQty;
    }
  }
  const rows = [];
  for (const [id, sups] of Object.entries(by)) {
    const names = Object.keys(sups);
    if (names.length < 2) continue;
    const article = articles.find((x) => x.id === id);
    if (!article) continue;
    const prices = names.map((n) => ({ supplier: n, price: sups[n].v / sups[n].q, qty: sups[n].q, spent: sups[n].v }))
      .sort((x, y) => x.price - y.price);
    const qty = prices.reduce((s, x) => s + x.qty, 0);
    const spent = prices.reduce((s, x) => s + x.spent, 0);
    const saving = spent - prices[0].price * qty;
    if (saving > 1) rows.push({ article, prices, qty, spent, saving, avg: spent / qty });
  }
  return rows.sort((x, y) => y.saving - x.saving);
}

// Même article, plusieurs références (variantes) : écart avec la moins chère.
function pilotVariantSavings(list, articles) {
  const by = {};
  for (const p of list) for (const it of (p.items || [])) {
    if (!it.articleId || !it.variantId || !(it.convertedQty > 0) || !(it.total > 0)) continue;
    const a = (by[it.articleId] = by[it.articleId] || {});
    const v = (a[it.variantId] = a[it.variantId] || { amount: 0, qty: 0 });
    v.amount += it.total; v.qty += it.convertedQty;
  }
  const rows = [];
  for (const [id, vars] of Object.entries(by)) {
    const article = articles.find((x) => x.id === id);
    if (!article || Object.keys(vars).length < 2) continue;
    const list2 = Object.entries(vars).map(([vid, d]) => ({
      name: (article.variants || []).find((v) => v.id === vid)?.name || 'Référence inconnue',
      price: d.amount / d.qty, qty: d.qty, amount: d.amount,
    })).sort((x, y) => x.price - y.price);
    const qty = list2.reduce((s, x) => s + x.qty, 0);
    const amount = list2.reduce((s, x) => s + x.amount, 0);
    const saving = amount - list2[0].price * qty;
    if (saving > 1) rows.push({ article, variants: list2, saving });
  }
  return rows.sort((x, y) => y.saving - x.saving);
}

// Économie totale sans double compte : par article, le meilleur des deux angles.
// Les références qui ne diffèrent que parce qu'elles viennent d'un autre fournisseur
// sont retirées de la liste « référence » (déjà comptées côté fournisseur).
function pilotSavings(list, articles) {
  const sup = pilotSupplierSavings(list, articles);
  const varAll = pilotVariantSavings(list, articles);
  const supBy = Object.fromEntries(sup.map((r) => [r.article.id, r.saving]));
  const vars = varAll.filter((r) => !(supBy[r.article.id] && Math.abs(r.saving - supBy[r.article.id]) <= 0.1 * supBy[r.article.id]));
  const per = { ...supBy };
  for (const r of varAll) per[r.article.id] = Math.max(per[r.article.id] || 0, r.saving);
  const total = Object.values(per).reduce((s, x) => s + x, 0);
  return { sup, vars, total };
}

// ─── Petits composants partagés ───────────────────────────────────────────
function PilotSection({ title, sub, right, children }) {
  return (
    <div className="mc-card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div>
          <h3 className="mc-display" style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{title}</h3>
          {sub && <div style={{ fontSize: 13, color: palette.inkSoft, marginTop: 3 }}>{sub}</div>}
        </div>
        {right}
      </div>
      {children}
    </div>
  );
}

function PilotStat({ label, value, sub, subColor, onClick }) {
  return (
    <div className="mc-card" onClick={onClick} style={{ padding: '16px 18px', cursor: onClick ? 'pointer' : 'default' }}>
      <div style={{ fontSize: 11, color: palette.inkSoft, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontFamily: 'Fraunces, serif', fontWeight: 700, fontSize: 26, color: palette.ink, marginTop: 6, lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: subColor || palette.inkSoft, marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

function PilotBars({ rows, color, max = 6 }) {
  const total = rows.reduce((s, r) => s + r.total, 0) || 1;
  const shown = rows.slice(0, max);
  const rest = rows.slice(max).reduce((s, r) => s + r.total, 0);
  const all = rest > 0 ? [...shown, { name: `Autres (${rows.length - max})`, total: rest, muted: true }] : shown;
  const top = Math.max(...all.map((r) => r.total), 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {all.map((r) => (
        <div key={r.name}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, marginBottom: 4 }}>
            <span style={{ color: r.muted ? palette.inkSoft : palette.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
            <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
              <strong>{formatEuro(r.total)}</strong>
              <span style={{ color: palette.inkSoft, marginLeft: 6, fontSize: 12 }}>{Math.round((r.total / total) * 100)} %</span>
            </span>
          </div>
          <div style={{ height: 6, background: palette.paper, borderRadius: 3 }}>
            <div style={{ height: 6, width: `${(r.total / top) * 100}%`, background: r.muted ? palette.rule : color, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function pilotPeriodLabel(from, to) {
  return `du ${formatShortDate(from, { withYear: true })} au ${formatShortDate(to, { withYear: true })}`;
}

const pilotEmpty = (text) => (
  <div style={{ fontSize: 13, color: palette.inkSoft, padding: '8px 0' }}>{text}</div>
);

// ─── RAPPORT ───────────────────────────────────────────────────────────────
function PilotReportView({ context }) {
  const { purchases, articles, dateFrom, dateTo, setActiveTab } = context;
  const isMobile = useIsMobile(720);
  const { from, to, cur, prev } = usePilotPeriods(purchases, dateFrom, dateTo);
  const [showDetail, setShowDetail] = useState(false);

  const total = cur.reduce((s, p) => s + (p.total || 0), 0);
  const prevTotal = prev.reduce((s, p) => s + (p.total || 0), 0);
  const evol = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : null;
  const supplierCount = new Set(cur.map((p) => (p.supplier || '').trim()).filter(Boolean)).size;

  const bySupplier = useMemo(() => {
    const m = {};
    for (const p of cur) { const s = (p.supplier || '').trim() || 'Fournisseur inconnu'; m[s] = (m[s] || 0) + (p.total || 0); }
    return Object.entries(m).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }, [cur]);

  const byCategory = useMemo(() => {
    const m = {};
    for (const p of cur) for (const it of (p.items || [])) {
      if (!(it.total > 0)) continue;
      const cat = articles.find((a) => a.id === it.articleId)?.category || 'Non classé';
      m[cat] = (m[cat] || 0) + it.total;
    }
    return Object.entries(m).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
  }, [cur, articles]);

  const increases = useMemo(() => pilotPriceIncreases(cur, prev, articles), [cur, prev, articles]);
  const savingTotal = useMemo(() => pilotSavings(cur, articles).total, [cur, articles]);

  const detail = useMemo(() => {
    const m = {};
    for (const p of cur) for (const it of (p.items || [])) {
      if (!it.articleId || !(it.total > 0)) continue;
      const e = (m[it.articleId] = m[it.articleId] || { qty: 0, amount: 0, n: 0 });
      e.qty += it.convertedQty || 0; e.amount += it.total; e.n += 1;
    }
    return Object.entries(m).map(([id, e]) => ({ article: articles.find((a) => a.id === id), ...e }))
      .filter((e) => e.article).sort((a, b) => b.amount - a.amount);
  }, [cur, articles]);

  const name = pilotRestaurantName();

  if (purchases.length === 0) {
    return <EmptyState icon={ClipboardList} title="Pas encore de rapport" description="Scannez vos premières factures : le rapport se remplit tout seul." />;
  }

  return (
    <div className="mc-print-zone" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="mc-print-header" style={{ marginBottom: 4 }}>
        <div style={{ fontFamily: 'Fraunces, serif', fontSize: 26, fontWeight: 700, color: palette.wine }}>{name}</div>
        <div style={{ fontSize: 14, color: palette.inkSoft, marginTop: 2 }}>Rapport des achats · {pilotPeriodLabel(from, to)}</div>
        <div style={{ fontSize: 11, color: palette.inkSoft, marginTop: 2 }}>Édité le {formatShortDate(pilotIsoDay(new Date()), { withYear: true })} · La Tambouille</div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 14, color: palette.inkSoft }}>{name} · {pilotPeriodLabel(from, to)}</div>
        <button className="mc-btn mc-btn-ghost" onClick={() => window.print()}><Download size={14} /> Exporter en PDF</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
        <PilotStat label="Achats" value={formatEuro(total)}
          sub={evol === null ? 'hors taxes' : `${evol > 0 ? '+' : ''}${evol.toFixed(1).replace('.', ',')} % vs période préc.`}
          subColor={evol === null ? undefined : evol > 5 ? palette.wine : evol < -5 ? palette.sage : undefined} />
        <PilotStat label="Factures" value={String(cur.length)} sub={`${supplierCount} fournisseur${supplierCount > 1 ? 's' : ''}`} />
        <PilotStat label="Hausses de prix" value={String(increases.length)}
          sub={prev.length ? (increases.length ? `${formatEuro(increases.reduce((s, r) => s + r.extra, 0))} de surcoût` : 'aucune hausse notable') : 'pas de période à comparer'}
          subColor={increases.length ? palette.wine : undefined} />
        <PilotStat label="Économies possibles" value={formatEuro(savingTotal)} sub="voir le détail →" subColor={palette.sage}
          onClick={() => setActiveTab && setActiveTab('savings')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16 }}>
        <PilotSection title="Par fournisseur">
          {bySupplier.length ? <PilotBars rows={bySupplier} color={palette.wine} /> : pilotEmpty('Aucun achat sur la période.')}
        </PilotSection>
        <PilotSection title="Par catégorie">
          {byCategory.length ? <PilotBars rows={byCategory} color={palette.sage} /> : pilotEmpty('Aucun achat sur la période.')}
        </PilotSection>
      </div>

      <PilotSection title="Ce qui a augmenté" sub="Prix moyen payé, comparé à la période précédente de même durée">
        {!prev.length ? pilotEmpty('Choisissez une période (30 J, 90 J…) pour comparer avec la précédente.')
          : increases.length === 0 ? pilotEmpty('Aucune hausse de plus de 3 % sur la période.')
          : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {increases.slice(0, 5).map((r, i) => (
                <div key={r.article.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderTop: i ? `1px solid ${palette.rule}` : 'none' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{r.article.name}</div>
                    <div style={{ fontSize: 12, color: palette.inkSoft }}>
                      {formatEuro(r.prev)} → {formatEuro(r.cur)} / {r.article.unit}
                    </div>
                  </div>
                  <span className="mc-pill" style={{ background: palette.wine + '15', color: palette.wine, fontWeight: 600 }}>+{r.pct.toFixed(0)} %</span>
                  <div style={{ width: isMobile ? 'auto' : 120, textAlign: 'right', fontSize: 13, whiteSpace: 'nowrap' }}>
                    +{formatEuro(r.extra)}
                  </div>
                </div>
              ))}
            </div>
          )}
      </PilotSection>

      <div className="mc-card" style={{ padding: 0 }}>
        <button onClick={() => setShowDetail((v) => !v)} style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px',
          background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: palette.ink,
        }}>
          <span className="mc-display" style={{ fontSize: 16, fontWeight: 600 }}>Détail par article ({detail.length})</span>
          <ChevronDown size={18} style={{ transform: showDetail ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
        </button>
        {showDetail && (
          <div style={{ padding: '0 20px 16px', overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: palette.inkSoft, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  <th style={{ textAlign: 'left', padding: '8px 0' }}>Article</th>
                  <th style={{ textAlign: 'right', padding: '8px 0' }}>Quantité</th>
                  <th style={{ textAlign: 'right', padding: '8px 0' }}>Montant HT</th>
                </tr>
              </thead>
              <tbody>
                {detail.map((e) => (
                  <tr key={e.article.id} style={{ borderTop: `1px solid ${palette.rule}` }}>
                    <td style={{ padding: '8px 0' }}>{e.article.name}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', whiteSpace: 'nowrap' }}>{e.qty.toFixed(e.qty < 10 ? 1 : 0).replace('.', ',')} {e.article.unit}</td>
                    <td style={{ padding: '8px 0', textAlign: 'right', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatEuro(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── ÉCONOMIES ─────────────────────────────────────────────────────────────
function PilotSavingsView({ context }) {
  const { purchases, articles, dateFrom, dateTo } = context;
  const isMobile = useIsMobile(720);
  const { from, to, cur } = usePilotPeriods(purchases, dateFrom, dateTo);
  const [showAllSup, setShowAllSup] = useState(false);
  const [showAllVar, setShowAllVar] = useState(false);

  const { sup: supRows, vars: varRows, total: grandTotal } = useMemo(() => pilotSavings(cur, articles), [cur, articles]);
  const supTotal = supRows.reduce((s, r) => s + r.saving, 0);
  const varTotal = varRows.reduce((s, r) => s + r.saving, 0);

  // Courbe de prix : article le plus acheté par défaut
  const chartArticles = useMemo(() => {
    const n = {};
    for (const p of purchases) for (const it of (p.items || [])) if (it.articleId && it.pricePerMasterUnit > 0) n[it.articleId] = (n[it.articleId] || 0) + 1;
    return articles.filter((a) => n[a.id]).sort((a, b) => n[b.id] - n[a.id]);
  }, [purchases, articles]);
  const [articleId, setArticleId] = useState(null);
  const selId = articleId || chartArticles[0]?.id;
  const sel = articles.find((a) => a.id === selId);
  const series = useMemo(() => {
    if (!selId) return [];
    const m = {};
    for (const p of purchases) {
      const month = (p.date || '').slice(0, 7);
      if (!month) continue;
      for (const it of (p.items || [])) {
        if (it.articleId !== selId || !(it.pricePerMasterUnit > 0) || !(it.convertedQty > 0)) continue;
        const e = (m[month] = m[month] || { v: 0, q: 0 });
        e.v += it.pricePerMasterUnit * it.convertedQty; e.q += it.convertedQty;
      }
    }
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).map(([month, e]) => ({ month, avg: Math.round((e.v / e.q) * 100) / 100 }));
  }, [purchases, selId]);
  const yDomain = useMemo(() => {
    if (!series.length) return [0, 1];
    const vals = series.map((s) => s.avg);
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const pad = Math.max((hi - lo) * 0.25, hi * 0.05);
    return [Math.max(0, Math.floor((lo - pad) * 10) / 10), Math.ceil((hi + pad) * 10) / 10];
  }, [series]);
  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const monthLabel = (m) => { const [y, mo] = m.split('-'); return `${MONTHS[+mo - 1]} ${y.slice(2)}`; };

  if (purchases.length === 0) {
    return <EmptyState icon={TrendingUp} title="Pas encore d'économies à calculer" description="Il faut quelques factures, idéalement de plusieurs fournisseurs, pour comparer les prix." />;
  }

  const row = (key, title, line, saving) => (
    <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: `1px solid ${palette.rule}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
        <div style={{ fontSize: 12, color: palette.inkSoft, marginTop: 2 }}>{line}</div>
      </div>
      <div className="mc-display" style={{ fontSize: 17, fontWeight: 700, color: palette.sage, whiteSpace: 'nowrap' }}>−{formatEuro(saving)}</div>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div className="mc-card" style={{ padding: '22px 24px', background: palette.sage + '12', borderColor: palette.sage + '40' }}>
        <div style={{ fontSize: 13, color: palette.inkSoft }}>{pilotPeriodLabel(from, to)}, vous auriez pu économiser</div>
        <div className="mc-display" style={{ fontSize: isMobile ? 34 : 42, fontWeight: 700, color: palette.sage, lineHeight: 1.15, margin: '4px 0' }}>
          {formatEuro(grandTotal)}
        </div>
        <div style={{ fontSize: 13, color: palette.inkSoft }}>
          en achetant chaque produit au meilleur prix que vous avez déjà payé. C'est un repère pour négocier :
          un fournisseur ne suit pas toujours sur tous les volumes.
        </div>
      </div>

      <PilotSection title="Changer de fournisseur" sub={`Même produit, acheté moins cher ailleurs · ${formatEuro(supTotal)}`}>
        {supRows.length === 0 ? pilotEmpty("Aucun produit acheté chez plusieurs fournisseurs à des prix différents sur la période.")
          : <>
              {(showAllSup ? supRows : supRows.slice(0, 5)).map((r) => row(r.article.id, r.article.name,
                <>Le moins cher : <strong style={{ color: palette.ink }}>{r.prices[0].supplier}</strong> à {formatEuro(r.prices[0].price)}/{r.article.unit} · vous avez payé {formatEuro(r.avg)}/{r.article.unit} en moyenne</>,
                r.saving))}
              {supRows.length > 5 && (
                <button className="mc-btn mc-btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAllSup((v) => !v)}>
                  {showAllSup ? 'Voir moins' : `Voir les ${supRows.length - 5} autres`}
                </button>
              )}
            </>}
      </PilotSection>

      {varRows.length > 0 && <PilotSection title="Choisir une autre référence" sub={`Même produit, conditionnement ou marque moins cher · ${formatEuro(varTotal)}`}>
        {<>
              {(showAllVar ? varRows : varRows.slice(0, 5)).map((r) => row(r.article.id, r.article.name,
                <>La moins chère : <strong style={{ color: palette.ink }}>{r.variants[0].name}</strong> à {formatEuro(r.variants[0].price)}/{r.article.unit} · la plus chère : {formatEuro(r.variants[r.variants.length - 1].price)}/{r.article.unit}</>,
                r.saving))}
              {varRows.length > 5 && (
                <button className="mc-btn mc-btn-ghost" style={{ marginTop: 10 }} onClick={() => setShowAllVar((v) => !v)}>
                  {showAllVar ? 'Voir moins' : `Voir les ${varRows.length - 5} autres`}
                </button>
              )}
            </>}
      </PilotSection>}

      <PilotSection title="Suivre le prix d'un produit" sub="Prix moyen payé chaque mois, tous fournisseurs confondus"
        right={chartArticles.length > 0 && (
          <select className="mc-input" style={{ width: isMobile ? '100%' : 240 }} value={selId || ''} onChange={(e) => setArticleId(e.target.value)}>
            {chartArticles.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}>
        {series.length < 2 ? pilotEmpty('Il faut au moins deux mois d’achats de ce produit pour tracer une courbe.') : (() => {
          const first = series[0].avg, last = series[series.length - 1].avg;
          const pct = ((last - first) / first) * 100;
          return (
            <>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13, marginBottom: 12 }}>
                <span><span style={{ color: palette.inkSoft }}>{monthLabel(series[0].month)} : </span><strong>{formatEuro(first)}/{sel?.unit}</strong></span>
                <span><span style={{ color: palette.inkSoft }}>{monthLabel(series[series.length - 1].month)} : </span><strong>{formatEuro(last)}/{sel?.unit}</strong></span>
                <span style={{ color: pct > 5 ? palette.wine : pct < -5 ? palette.sage : palette.ink, fontWeight: 600 }}>{pct > 0 ? '+' : ''}{pct.toFixed(1).replace('.', ',')} %</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={series} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                  <CartesianGrid stroke={palette.rule} strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="month" tickFormatter={monthLabel} tick={{ fontSize: 11, fill: palette.inkSoft }} stroke={palette.rule} minTickGap={24} />
                  <YAxis domain={yDomain} tickCount={5} allowDecimals tick={{ fontSize: 11, fill: palette.inkSoft }} stroke={palette.rule} width={64}
                    tickFormatter={(v) => formatEuro(v)} />
                  <Tooltip formatter={(v) => [`${formatEuro(v)}/${sel?.unit}`, 'Prix moyen']} labelFormatter={monthLabel}
                    contentStyle={{ background: palette.cream, border: `1px solid ${palette.rule}`, borderRadius: 6, fontSize: 12 }} />
                  <Line type="linear" dataKey="avg" stroke={palette.wine} strokeWidth={2} dot={{ r: 3, fill: palette.wine }} activeDot={{ r: 5 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </>
          );
        })()}
      </PilotSection>
    </div>
  );
}
