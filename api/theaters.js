// 劇場一覧（スラッグ＋日本語名＋チェーン）
// ユナイテッド・シネマはトップページの劇場リンク（<img alt="劇場名">）から抽出する。
// それ以外のチェーンは lib/chains.js の登録表から集める（劇場マスタを持つチェーンは実データを取りに行く）。
// 劇場が増減することは稀なので CDN に1日キャッシュさせる。

import { chainTheaters, CHAIN_LABEL } from '../lib/chains.js';

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';

export default async function handler(req, res) {
  // ユナイテッド側の取得に失敗しても、他チェーンは返す
  const united = [];
  let error = null;
  try {
    const r = await fetch('https://www.unitedcinemas.jp/index.html', {
      headers: { 'User-Agent': UA },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const html = new TextDecoder('shift_jis').decode(await r.arrayBuffer());

    const seen = new Set();
    for (const m of html.matchAll(
      /href="\/([a-z0-9-]+)\/[^"]*"[^>]*>\s*<img[^>]*theater\/list\/[a-z0-9-]+\.gif[^>]*alt="([^"]+)"/g)) {
      const slug = m[1];
      const name = m[2].trim();
      if (seen.has(slug)) continue;
      seen.add(slug);
      united.push({ slug, name, chain: 'united', comingSoon: /coming\s*soon/i.test(name) });
    }
    if (!united.length) error = 'ユナイテッド・シネマの劇場一覧を抽出できなかった（サイト構造の変更かもしれない）';
  } catch (e) {
    error = `ユナイテッド・シネマの劇場一覧の取得に失敗: ${e.message}`;
  }

  const theaters = [...united, ...await chainTheaters()]
    .map((t) => ({ ...t, chainLabel: CHAIN_LABEL[t.chain] || t.chain }));

  // ブラウザには毎回確認させ（劇場が増えたときに古い一覧を掴み続けないように）、
  // CDN側では1日キャッシュさせる。max-age を省くとブラウザが古い応答を持ち続けることがある
  if (!error) res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate, s-maxage=86400, stale-while-revalidate=604800');
  res.json({ count: theaters.length, theaters, ...(error && { error }) });
}
