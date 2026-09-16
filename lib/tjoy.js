// T・ジョイ（新宿バルト9・T・ジョイ横浜 を含む20館）アダプタ
//
// 当日分は劇場トップページに直書き、他の日付は CSRF トークン付きの POST で HTML 断片が返る。
//   POST https://tjoy.jp/theaterTop/scheduleGetHtmlApi
//     data={"date":"YYYY-MM-DD","theaterId":"140"} & _csrfToken=...
// トークンは劇場トップの <meta name="csrf-token"> にあり、Cookie とセットで送る必要がある。
//
// 購入URLは GET で座席選択に着く（2026-09-16 実測。ログイン不要）。
//   https://tjoy.jp/{スラッグ}/reservation/index/{上映回ID}/{作品コード}/{スクリーン}/{日付}?type=film
// ただし掲載されるのは当日＋2日先までで、掲載された回はすでに販売中。
// つまり「掲載＝販売開始」で、事前に上映回IDを押さえることはできない。
//
// 応答ヘッダに Queue-it のコネクタが常に付いている。混雑時に待機列が出る可能性がある（未検証）。

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';
const PREFIX = 'tj-';

const httpError = (status, message) => Object.assign(new Error(message), { status });

// 劇場IDは各劇場ページの #theaterId から取得（2026-09-16・全20館）
export const TJOY_THEATERS = [
  { slug: 'tj-shinjuku_wald9', no: '140', name: '新宿バルト9' },
  { slug: 'tj-tjoy-prince-shinagawa', no: '180', name: 'T・ジョイ PRINCE 品川' },
  { slug: 'tj-t-joy_seibu_oizumi', no: '120', name: 'T・ジョイ SEIBU 大泉' },
  { slug: 'tj-t-joy_yokohama', no: '190', name: 'T・ジョイ横浜' },
  { slug: 'tj-yokohama_burg13', no: '170', name: '横浜ブルク13' },
  { slug: 'tj-t-joy_soga', no: '130', name: 'T・ジョイ蘇我' },
  { slug: 'tj-t-joy_emiterrace_tokorozawa', no: '200', name: 'T・ジョイ エミテラス所沢' },
  { slug: 'tj-kounosu-cinema', no: '900', name: 'こうのすシネマ' },
  { slug: 'tj-t-joy_niigatabandai', no: '110', name: 'T・ジョイ新潟万代' },
  { slug: 'tj-t-joy_nagaoka', no: '150', name: 'T・ジョイ長岡' },
  { slug: 'tj-t-joy_umeda', no: '320', name: 'T・ジョイ梅田' },
  { slug: 'tj-t-joy_kyoto', no: '360', name: 'T・ジョイ京都' },
  { slug: 'tj-hiroshima_wald11', no: '330', name: '広島バルト11' },
  { slug: 'tj-t-joy_higashihiroshima', no: '310', name: 'T・ジョイ東広島' },
  { slug: 'tj-t-joy_izumo', no: '160', name: 'T・ジョイ出雲' },
  { slug: 'tj-t-joy_hakata', no: '550', name: 'T・ジョイ博多' },
  { slug: 'tj-t-joy_kurume', no: '540', name: 'T・ジョイ久留米' },
  { slug: 'tj-t-joy_riverwalk_kitakyusyu', no: '520', name: 'T・ジョイ リバーウォーク 北九州' },
  { slug: 'tj-t-joy_parkplace_oita', no: '510', name: 'T・ジョイ パークプレイス 大分' },
  { slug: 'tj-kagoshima_mitte10', no: '530', name: '鹿児島ミッテ10' },
];

export const TJOY_PREFIX = PREFIX;
export const tjoyTheaters = async () =>
  TJOY_THEATERS.map(({ slug, name }) => ({ slug, name, chain: 'tjoy', comingSoon: false }));

export async function loadTjoy(th, d) {
  const theater = TJOY_THEATERS.find((x) => x.slug === th);
  if (!theater) throw httpError(400, `劇場スラッグ ${th} は未対応`);
  const slug = th.slice(PREFIX.length);

  // 1) 劇場トップで CSRF トークンと Cookie を取る
  const top = await fetch(`https://tjoy.jp/${slug}`, { headers: { 'User-Agent': UA }, cache: 'no-store' });
  if (!top.ok) throw httpError(502, `劇場ページの取得に失敗 (HTTP ${top.status})`);
  const topHtml = await top.text();
  const token = (topHtml.match(/name="csrf-token" content="([^"]+)"/) || [])[1];
  const cookie = (top.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');

  // 2) 指定日のスケジュールを POST で取る（当日はトップページのHTMLをそのまま使う）
  let html = topHtml;
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  if (d !== today) {
    if (!token) throw httpError(502, 'CSRFトークンが取得できなかった（サイト構造の変更かもしれない）');
    const body = new URLSearchParams({ data: JSON.stringify({ date: d, theaterId: theater.no }), _csrfToken: token });
    const r = await fetch('https://tjoy.jp/theaterTop/scheduleGetHtmlApi', {
      method: 'POST',
      headers: {
        'User-Agent': UA, 'X-CSRF-Token': token, 'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded', ...(cookie && { Cookie: cookie }),
      },
      body,
    });
    if (!r.ok) throw httpError(502, `スケジュール取得に失敗 (HTTP ${r.status})`);
    html = await r.text();
  }

  // 作品ブロック：<h5 class="js-title-film ...">作品名</h5> ... 予約リンク群
  const blocks = [];
  for (const part of html.split(/<h5 class="js-title-film/).slice(1)) {
    const name = decodeEntities((part.match(/^[^>]*>([\s\S]*?)<\/h5>/) || [])[1]?.replace(/<[^>]+>/g, '').trim() || '');
    const film = (part.match(/reservation\/index\/\d+\/([A-Z0-9]+)\//) || [])[1]
      || (part.match(/cinema_detail\/([A-Z0-9]+)/) || [])[1];
    if (!film) continue;
    if (blocks.some((b) => b.film === film)) continue;
    blocks.push({ film, name: name || `作品${film}`, html: part });
  }

  return {
    films: blocks.map(({ film, name }) => ({ film, name })),
    screeningsOf: (film) => parse(blocks.find((b) => b.film === film)?.html || '', slug),
    jumpUrl: (hit) => hit.direct,
  };
}

function parse(block, slug) {
  const screenings = [];
  for (const box of block.split(/<li class="schedule-box/).slice(1)) {
    const time = (box.match(/<p class="schedule-time mb-0">\s*(\d{1,2}:\d{2})/) || [])[1];
    if (!time) continue;
    const end = (box.match(/<span>\s*[～~]\s*(\d{1,2}:\d{2})/) || [])[1] || '';
    const screen = decodeEntities((box.match(/<div class="theater-name[^"]*">\s*<a[^>]*>([^<]+)<\/a>/) || [])[1]?.trim() || '');
    const path = (box.match(/reservation\/index\/\d+\/[A-Z0-9]+\/\d+\/[\d-]+\?type=[a-z]+/) || [])[0];
    // 予約リンクがあれば購入可、なければ満席などで購入不可
    const label = decodeEntities((box.match(/class="schedule-status[^"]*"[^>]*>\s*([^<]{1,20})/) || [])[1]?.trim() || '');
    const status = path ? 'onsale' : /満席/.test(label) ? 'closed' : 'closed';
    screenings.push({
      time, end, screen, status,
      onSale: !!path,
      seat: /満席/.test(label) ? '×' : null,
      direct: path ? `https://tjoy.jp/${slug}/${path.replace(/^\//, '')}` : null,
      saleStart: null, // 掲載＝販売開始のため、回ごとの販売開始日時は出ない
      id: (path?.match(/reservation\/index\/(\d+)\//) || [])[1] || null,
      note: label || null,
    });
  }
  return screenings;
}

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n));
