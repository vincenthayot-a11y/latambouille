"""Rattachement des lignes de facture aux articles : plus de « contient »
(« ANANAS » ne doit pas tomber dans « Glace à l'ananas »)."""
import sys

OLD4 = """  // 4. Partial alias match
  for (const article of articles) {
    for (const variant of article.variants || []) {
      if (
        variant.aliases?.some((a) => {
          const aliasLabel = normalizeText(a.label);
          return aliasLabel.includes(target) || target.includes(aliasLabel);
        })
      ) {
        return { article, variant };
      }
    }
  }
"""
NEW4 = """  // 4. Libellé proche : exactement les mêmes mots, sans tenir compte de
  //    l'ordre, des accents ni du conditionnement (« SORBET ANANAS 2,5L » =
  //    « Sorbet ananas »). Un libellé qui en CONTIENT un autre ne suffit pas :
  //    « ANANAS » n'est pas « GLACE A L'ANANAS ».
  const targetKey = labelWordsKey(label);
  if (targetKey) {
    for (const article of articles) {
      for (const variant of article.variants || []) {
        if (labelWordsKey(variant.name) === targetKey ||
            variant.aliases?.some((a) => labelWordsKey(a.label) === targetKey)) {
          return { article, variant };
        }
      }
    }
  }
"""
WORDS = """
const LABEL_STOP_WORDS = new Set(['de', 'du', 'des', 'la', 'le', 'les', 'l', 'd', 'a', 'au', 'aux', 'et', 'en', 'x',
  'kg', 'g', 'gr', 'l', 'cl', 'ml', 'lt', 'pc', 'pce', 'pces', 'piece', 'pieces', 'u', 'un', 'unite', 'ctn', 'colis', 'carton', 'bte', 'boite', 'sac', 'seau', 'pot', 'bidon', 'pack', 'lot']);
function labelWordsKey(text) {
  const words = normalizeText(text).replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w && !/\\d/.test(w) && !LABEL_STOP_WORDS.has(w));
  return [...new Set(words)].sort().join(' ');
}
"""
OLDPK = """          // Register packaging if novel
          const isPackaged"""
NEWPK = """          // Ce libellé appartient désormais à cette variante : on le retire des
          // autres (corrige un mauvais rattachement une fois pour toutes).
          if (item.label) {
            const lbl = normalizeText(item.label);
            updatedArticles = updatedArticles.map((a) =>
              (a.variants || []).some((v) => v.id !== variant.id && (v.aliases || []).some((x) => normalizeText(x.label) === lbl))
                ? { ...a, variants: a.variants.map((v) => v.id === variant.id ? v : { ...v, aliases: (v.aliases || []).filter((x) => normalizeText(x.label) !== lbl) }) }
                : a
            );
          }

          // Register packaging if novel
          const isPackaged"""

def patch(s):
    for old in (OLD4, OLDPK, "function findArticleByLabel(label, articles) {"):
        if s.count(old) != 1: sys.exit(f'fix_matching: {s.count(old)} matches for {old[:60]!r}')
    s = s.replace(OLD4, NEW4).replace(OLDPK, NEWPK)
    s = s.replace("function findArticleByLabel(label, articles) {", WORDS.lstrip() + "\nfunction findArticleByLabel(label, articles) {")
    return s

HINT_OLD = "Sinon, donne un nom court et générique sans le conditionnement."
HINT_NEW = ("Attention : un ingrédient n'est pas le même produit qu'un produit préparé qui le contient "
            "(« ANANAS » n'est pas « Glace à l'ananas », « LAIT » n'est pas « Lait de coco »). "
            "Sinon, donne un nom court et générique sans le conditionnement.")

if __name__ == '__main__':
    p = sys.argv[1]; s = open(p, encoding='utf-8').read()
    s = patch(s)
    assert s.count(HINT_OLD) == 1; s = s.replace(HINT_OLD, HINT_NEW)
    open(p, 'w', encoding='utf-8').write(s); print('patched', p)
