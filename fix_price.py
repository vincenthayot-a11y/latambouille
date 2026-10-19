"""Contrôle « prix inhabituel » dans la fiche facture (les deux versions)."""
import sys

HELPERS = r"""
// ─── Prix habituel d'un article ─────────────────────────────────────────
// Médiane des prix payés sur ses 10 dernières lignes de facture. Un prix qui
// s'en écarte de plus de 45 % trahit souvent une quantité mal lue (colis
// compté comme une bouteille, poids mal lu…).
const UNUSUAL_PRICE_RATIO = 1.45;
function usualPriceFor(articleId, purchases, excludePurchaseId, variantId) {
  if (!articleId) return 0;
  const seen = [], seenVariant = [];
  for (const p of purchases || []) {
    if (excludePurchaseId && p.id === excludePurchaseId) continue;
    for (const it of p.items || []) {
      if (it.articleId !== articleId || !(it.pricePerMasterUnit > 0)) continue;
      seen.push([p.date || '', it.pricePerMasterUnit]);
      if (variantId && it.variantId === variantId) seenVariant.push([p.date || '', it.pricePerMasterUnit]);
    }
  }
  // Même référence d'abord (deux marques d'un même article n'ont pas le même prix)
  if (seenVariant.length) return usualPriceMedian(seenVariant);
  if (!seen.length) return 0;
  return usualPriceMedian(seen);
}
function usualPriceMedian(seen) {
  const last = seen.sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 10).map((x) => x[1]).sort((a, b) => a - b);
  return last[Math.floor(last.length / 2)];
}
function isUnusualPrice(price, usual) {
  return usual > 0 && price > 0 && (price / usual > UNUSUAL_PRICE_RATIO || usual / price > UNUSUAL_PRICE_RATIO);
}

"""
SIG_OLD = "function PurchaseLine({ item, index, articles, onUpdate, onRemove }) {"
SIG_NEW = "function PurchaseLine({ item, index, articles, onUpdate, onRemove, usualPrice = 0 }) {"
BOX_OLD = """  const masterUnit = matchedArticle ? matchedArticle.unit : item.masterUnit || 'kg';\n"""
BOX_NEW = """  const masterUnit = matchedArticle ? matchedArticle.unit : item.masterUnit || 'kg';
  const unusual = isUnusualPrice(item.pricePerMasterUnit, usualPrice);
"""
DIV_OLD = """    <div style={{ padding: 14, background: palette.paper, borderRadius: 8, marginBottom: 8 }}>
      {item.label && ("""
DIV_NEW = """    <div style={{ padding: 14, background: unusual ? palette.amber + '14' : palette.paper, border: unusual ? `1px solid ${palette.amber}66` : '1px solid transparent', borderRadius: 8, marginBottom: 8 }}>
      {item.label && ("""
WARN_OLD = """      {matchedArticle && matchedVariant && (
        <div style={{ marginTop: 8, fontSize: 12, color: palette.sage, display: 'flex', alignItems: 'center', gap: 4 }}>"""
WARN_NEW = """      {unusual && (
        <div style={{ marginTop: 8, padding: '6px 10px', background: palette.amber + '22', color: palette.ink, borderRadius: 6, fontSize: 12 }}>
          <strong style={{ color: palette.amber }}>⚠ Prix inhabituel :</strong> {formatEuro(item.pricePerMasterUnit)}/{masterUnit}, d'habitude {formatEuro(usualPrice)}/{masterUnit}.
          {' '}Vérifiez la quantité sur la facture (colis de plusieurs bouteilles, poids…).
        </div>
      )}

      {matchedArticle && matchedVariant && (
        <div style={{ marginTop: 8, fontSize: 12, color: palette.sage, display: 'flex', alignItems: 'center', gap: 4 }}>"""
USE_OLD = """              articles={articles}
              onUpdate={updateLine}
              onRemove={removeLine}
            />"""
USE_NEW = """              articles={articles}
              onUpdate={updateLine}
              onRemove={removeLine}
              usualPrice={usualPriceFor(item.articleId, existingPurchases, form.id, item.variantId)}
            />"""

def patch(s):
    for old in (SIG_OLD, BOX_OLD, DIV_OLD, WARN_OLD, USE_OLD):
        c = s.count(old)
        if c != 1: sys.exit(f'fix_price: {c} matches for {old[:70]!r}')
    s = s.replace(SIG_OLD, HELPERS.lstrip() + SIG_NEW).replace(BOX_OLD, BOX_NEW).replace(DIV_OLD, DIV_NEW).replace(WARN_OLD, WARN_NEW).replace(USE_OLD, USE_NEW)
    return s

if __name__ == '__main__':
    p = sys.argv[1]; s = patch(open(p, encoding='utf-8').read()); open(p, 'w', encoding='utf-8').write(s); print('patched', p)
