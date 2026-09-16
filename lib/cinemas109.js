// 109シネマズ（19館）アダプタ
//
// 公式サイトは静的HTML。日別スケジュールが iframe 用のページとして配信されている。
//   https://109cinemas.net/{スラッグ}/schedules/{YYYYMMDD}.html?theater_code={劇場コード}
//
// ユナイテッド・シネマと同じ「販売後に抜く」型。購入リンク（ttc＝作品×上映回コード）は
// 販売開始まで HTML に現れないので、上映回IDを事前に押さえることはできない。
//   購入: https://cinema.109cinemas.net/cgi-bin/pc/resv/resv_shw_ppt.cgi?ttc=&tsc=&tssc=&ymd=&cs=&stt=
// 2026-09-16 実測：この購入URLは302を挟まず、ログインも待機列もなしで座席選択ページが返る。
//
// 販売開始は公式のお知らせ（2025-07-03 鑑賞分から）：
//   一般は上映2日前0:00、シネマポイント会員は上映3日前21:00。

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';
const PREFIX = 'c109-';

const httpError = (status, message) => Object.assign(new Error(message), { status });

// 劇場コードは各劇場ページのスケジュールiframeのURLから取得（2026-09-16）。数字とは限らない
export const C109_THEATERS = [
  { slug: 'c109-kiba', no: '20', name: '109シネマズ木場' },
  { slug: 'c109-kohoku', no: '13', name: '109シネマズ港北' },
  { slug: 'c109-kawasaki', no: 'I1', name: '109シネマズ川崎' },
  { slug: 'c109-futakotamagawa', no: 'T1', name: '109シネマズ二子玉川' },
  { slug: 'c109-grandberrypark', no: 'G1', name: '109シネマズグランベリーパーク' },
  { slug: 'c109-shonan', no: 'R1', name: '109シネマズ湘南' },
  { slug: 'c109-movil', no: '72', name: 'ムービル（109シネマズ）' },
  { slug: 'c109-sano', no: 'C1', name: '109シネマズ佐野' },
  { slug: 'c109-shobu', no: 'M1', name: '109シネマズ菖蒲' },
  { slug: 'c109-tomiya', no: '44', name: '109シネマズ富谷' },
  { slug: 'c109-yumegaoka', no: 'Z1', name: '109シネマズ夢が丘' },
  { slug: 'c109-nagoya', no: 'A1', name: '109シネマズ名古屋' },
  { slug: 'c109-meiwa', no: '36', name: '109シネマズ明和' },
  { slug: 'c109-yokkaichi', no: '63', name: '109シネマズ四日市' },
  { slug: 'c109-osaka-expocity', no: 'V1', name: '109シネマズ大阪エキスポシティ' },
  { slug: 'c109-minoh', no: '54', name: '109シネマズ箕面' },
  { slug: 'c109-hatkobe', no: 'E1', name: '109シネマズHAT神戸' },
  { slug: 'c109-hiroshima', no: 'P1', name: '109シネマズ広島' },
  { slug: 'c109-saga', no: 'K1', name: '109シネマズ佐賀' },
  { slug: 'c109-premiumshinjuku', no: 'X1', name: '109シネマズプレミアム新宿' },
];
// 高崎は劇場ページ・スケジュールとも 500 を返すため未対応（2026-09-16 時点。サイト側の不具合と思われる）

export const C109_PREFIX = PREFIX;
export const c109Theaters = async () =>
  C109_THEATERS.map(({ slug, name }) => ({ slug, name, chain: 'c109', comingSoon: false }));

// 状態クラス → cinema-jump の状態。クラス名は schedule.css の定義から
const STATUS = {
  available: ['onsale', null],
  remaining: ['onsale', '△'],
  presale: ['presale', null],
  member: ['presale', null],
  soldout: ['closed', '×'],
  close: ['closed', null],
  others: ['before', null],
};

export async function load109(th, d) {
  const theater = C109_THEATERS.find((x) => x.slug === th);
  if (!theater) throw httpError(400, `劇場スラッグ ${th} は未対応`);
  const date = d.replace(/-/g, '');

  const r = await fetch(`https://109cinemas.net/${th.slice(PREFIX.length)}/schedules/${date}.html?theater_code=${theater.no}`,
    { headers: { 'User-Agent': UA }, cache: 'no-store' });
  if (!r.ok) throw httpError(502, `スケジュール取得に失敗 (HTTP ${r.status})`);
  const html = await r.text();

  // 作品ブロックは <!-- {:theater_code=>'20',:film_code=>'52530'} 20260917 --> に続く <article>
  const blocks = [];
  for (const m of html.matchAll(/<!--\s*\{:theater_code=>'[^']*',:film_code=>'(\d+)'\}[^>]*-->\s*(<article[\s\S]*?<\/article>)/g)) {
    blocks.push({ film: m[1], html: m[2] });
  }

  const films = blocks.map((b) => ({
    film: b.film,
    name: decodeEntities((b.html.match(/<h2>([^<]+)<\/h2>/) || [])[1]?.trim() || `作品${b.film}`),
  }));

  return {
    films,
    screeningsOf: (film) => parse(blocks.find((b) => b.film === film)?.html || ''),
    jumpUrl: (hit) => hit.direct,
  };
}

function parse(block) {
  const screenings = [];
  let screen = '';
  // <li class="theatre"> でスクリーンが切り替わり、<li class="check_date"> が各回
  for (const li of block.split(/<li class="/).slice(1)) {
    if (li.startsWith('theatre')) {
      // 通常館は「シアター1」、プレミアム新宿は「THEATER 7」と表記が違う
      const m = li.match(/(シアター|THEATER)\s*<span class="theatre-num">\s*(\d+)\s*<\/span>/);
      const fmt = (li.match(/<\/a>\s*([^<]+?)\s*<br>/) || [])[1]?.trim();
      screen = (m ? `${m[1] === 'THEATER' ? 'THEATER ' : 'シアター'}${m[2]}` : '') + (fmt ? ` ${fmt}` : '');
      continue;
    }
    if (!li.startsWith('check_date')) continue;
    const time = (li.match(/<time class="start">(\d{1,2}:\d{2})<\/time>/) || [])[1];
    if (!time) continue;
    const end = (li.match(/<time class="end">(\d{1,2}:\d{2})<\/time>/) || [])[1] || '';
    const cls = (li.match(/<div class="(available|remaining|presale|member|soldout|close|others)"/) || [])[1] || 'close';
    const [status, seat] = STATUS[cls] || ['closed', null];
    const direct = (li.match(/href="(https:\/\/cinema\.109cinemas\.net\/[^"]+)"/) || [])[1]?.replace(/&amp;/g, '&') || null;
    screenings.push({
      time, end, screen, status,
      onSale: (status === 'onsale' || status === 'presale') && !!direct,
      seat, direct,
      saleStart: null, // 109のHTMLには回ごとの販売開始日時が出ない（一般は上映2日前0:00）
      id: null,
    });
  }
  return screenings;
}

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n));
