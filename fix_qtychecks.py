"""Alertes : section « Quantités à vérifier » (même règle que la ligne orange)."""
import sys

COMPONENT = r"""
// ─── Alertes : quantités à vérifier ─────────────────────────────────────
// Lignes des 60 derniers jours dont le prix unitaire s'écarte de plus de 45 %
// du prix habituel (plus cher OU moins cher) : le plus souvent une quantité
// mal lue sur la facture (colis compté comme une bouteille, poids…).
function quantityChecks(purchases, articles, checked = []) {
  const since = new Date(); since.setDate(since.getDate() - 60);
  const sinceStr = since.toISOString().slice(0, 10);
  const checkedSet = new Set(checked);
  const out = [];
  for (const p of purchases || []) {
    if (!p.date || p.date < sinceStr || p.kind === 'other') continue;
    (p.items || []).forEach((it, idx) => {
      if (!it.articleId || !(it.pricePerMasterUnit > 0)) return;
      const id = `${p.id}:${idx}`;
      if (checkedSet.has(id)) return;
      const usual = usualPriceFor(it.articleId, purchases, p.id, it.variantId);
      if (!isUnusualPrice(it.pricePerMasterUnit, usual)) return;
      const article = (articles || []).find((a) => a.id === it.articleId);
      if (!article) return;
      out.push({ id, purchase: p, item: it, article, usual, ratio: it.pricePerMasterUnit / usual });
    });
  }
  return out.sort((a, b) => (b.purchase.date || '').localeCompare(a.purchase.date || ''));
}

function QuantityChecksSection({ purchases, articles, alertSettings, setAlertSettings, setActiveTab }) {
  const [showAll, setShowAll] = useState(false);
  const list = useMemo(() => quantityChecks(purchases, articles, alertSettings?.checkedAnomalies || []),
    [purchases, articles, alertSettings]);
  if (!list.length) return null;
  const shown = showAll ? list : list.slice(0, 8);
  const markOk = (id) => {
    setAlertSettings((s) => ({ ...s, checkedAnomalies: [...((s && s.checkedAnomalies) || []), id].slice(-500) }));
    mcToast.success('Noté, cette ligne ne sera plus signalée');
  };
  const open = (p) => { window.__openPurchaseId = p.id; setActiveTab && setActiveTab('purchases'); };
  return (
    <section style={{ marginBottom: 32 }}>
      <h3 className="mc-display" style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>
        Quantités à vérifier ({list.length})
      </h3>
      <p style={{ fontSize: 13, color: palette.inkSoft, margin: '0 0 12px' }}>
        Prix très différent de d'habitude : souvent une quantité mal lue sur la facture. Ouvrez la facture pour corriger, ou confirmez si c'est juste.
      </p>
      <div className="mc-card" style={{ padding: '4px 20px' }}>
        {shown.map((c, i) => (
          <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: i ? `1px solid ${palette.rule}` : 'none', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.article.name}</span>
                <span className="mc-pill" style={{ background: palette.amber + '22', color: palette.amber, fontWeight: 600 }}>
                  {c.ratio >= 1 ? `×${c.ratio.toFixed(1).replace('.', ',')} plus cher` : `÷${(1 / c.ratio).toFixed(1).replace('.', ',')} moins cher`}
                </span>
              </div>
              <div style={{ fontSize: 13, marginTop: 3 }}>
                Lu <strong>{formatEuro(c.item.pricePerMasterUnit)}/{c.article.unit}</strong>
                {' '}({String(Math.round((c.item.convertedQty || 0) * 100) / 100).replace('.', ',')} {c.article.unit} pour {formatEuro(c.item.total || 0)})
                <span style={{ color: palette.inkSoft }}> · d'habitude {formatEuro(c.usual)}/{c.article.unit}</span>
              </div>
              <div style={{ fontSize: 12, color: palette.inkSoft, marginTop: 2 }}>
                {c.purchase.supplier || 'Fournisseur inconnu'}{c.purchase.invoiceNumber ? ` · facture ${c.purchase.invoiceNumber}` : ''} · {formatShortDate(c.purchase.date, { withYear: true })}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="mc-btn mc-btn-ghost" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => open(c.purchase)}>Ouvrir la facture</button>
              <button className="mc-btn mc-btn-ghost" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => markOk(c.id)}>C'est correct</button>
            </div>
          </div>
        ))}
        {list.length > 8 && (
          <button className="mc-btn mc-btn-ghost" style={{ margin: '4px 0 12px' }} onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Voir moins' : `Voir les ${list.length - 8} autres`}
          </button>
        )}
      </div>
    </section>
  );
}

"""
# Ouvrir une facture depuis les Alertes
OPEN_OLD = "  const [editingPurchase, setEditingPurchase] = useState(null);\n"
OPEN_NEW = OPEN_OLD + """  useEffect(() => {
    const id = window.__openPurchaseId;
    if (!id) return;
    window.__openPurchaseId = null;
    const p = purchases.find((x) => x.id === id);
    if (p) setEditingPurchase(p);
  }, []);
"""
ANCHOR = "function PurchaseLine({"

def patch(s, alerts_anchor=None, alerts_insert=None):
    for old in (OPEN_OLD, ANCHOR):
        if s.count(old) != 1: sys.exit(f'fix_qtychecks: {s.count(old)} matches for {old[:60]!r}')
    s = s.replace(OPEN_OLD, OPEN_NEW)
    i = s.index(ANCHOR)
    # placé après les helpers de prix (usualPriceFor) qui précèdent PurchaseLine
    s = s[:i] + COMPONENT.lstrip() + s[i:]
    if alerts_anchor:
        if s.count(alerts_anchor) != 1: sys.exit(f'fix_qtychecks: alerts anchor {s.count(alerts_anchor)}')
        s = s.replace(alerts_anchor, alerts_insert + alerts_anchor)
    return s

USER_ALERTS_ANCHOR = "      {/* ─── Stock alerts ──────────────────────────────────────────────── */}\n"
USER_ALERTS_INSERT = """      <QuantityChecksSection purchases={purchases} articles={articles} alertSettings={alertSettings}
        setAlertSettings={setAlertSettings} setActiveTab={context.setActiveTab} />

"""

if __name__ == '__main__':
    p = sys.argv[1]
    s = patch(open(p, encoding='utf-8').read(), USER_ALERTS_ANCHOR, USER_ALERTS_INSERT)
    open(p, 'w', encoding='utf-8').write(s); print('patched', p)
