// ユナイテッド・シネマの劇場一覧（スラッグ＋日本語名）
// トップページの劇場リンク（<img alt="劇場名">）から抽出する。
// 劇場が増減することは稀なので CDN に1日キャッシュさせる。

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';

export default async function handler(req, res) {
  try {
    const r = await fetch('https://www.unitedcinemas.jp/index.html', {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) return res.status(502).json({ error: `劇場一覧の取得に失敗 (HTTP ${r.status})` });
    const html = new TextDecoder('shift_jis').decode(await r.arrayBuffer());

    const theaters = [];
    const seen = new Set();
    for (const m of html.matchAll(
      /href="\/([a-z0-9-]+)\/[^"]*"[^>]*>\s*<img[^>]*theater\/list\/[a-z0-9-]+\.gif[^>]*alt="([^"]+)"/g)) {
      const slug = m[1];
      const name = m[2].trim();
      if (seen.has(slug)) continue;
      seen.add(slug);
      theaters.push({ slug, name, comingSoon: /coming\s*soon/i.test(name) });
    }

    if (!theaters.length) return res.status(500).json({ error: '劇場一覧を抽出できなかった（サイト構造の変更かもしれない）' });

    res.setHeader('Cache-Control', 's-maxage=86400, stale-while-revalidate=604800');
    res.json({ count: theaters.length, theaters });
  } catch (e) {
    res.status(502).json({ error: `劇場一覧の取得に失敗: ${e.message}` });
  }
}
