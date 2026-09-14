// スターシアターズ（沖縄：シネマQ ほか6館）アダプタ
//
// 公式サイト startheaters.jp は Nuxt の静的サイトで、上映回はブラウザ側で静的JSONから組み立てている。
//   /schedule/data/schedule.json                     作品No × 劇場No × 日付 × 時刻 → 販売開始日時のみ
//   /schedule/data/{作品No}/{劇場No}/{YYYYMMDD}.json  上映回本体（eventId・空席・販売期間）
// 購入は SMART THEATER（reserve.smart-theater.com）。eventId を末尾に付けるだけで座席選択に直行する。
//
// ユナイテッド・シネマとの決定的な違い：eventId はスケジュール掲載と同時に確定している。
// 販売開始前から購入URLを組めて、販売前に開くと「販売期間外」画面になる（2026-09-15 実測）。

const BASE = 'https://startheaters.jp/schedule/data';
const TICKET_URL = 'https://reserve.smart-theater.com/projects/startheaters-production/purchase/transaction/';
const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';

// no は公式サイトCMSの smart_theater_no（theaters/1 の payload.js から取得・2026-09-15）
export const STAR_THEATERS = [
  { slug: 'st-cinemaq', no: 'p001', name: 'シネマQ' },
  { slug: 'st-palette', no: 'p002', name: 'シネマパレット' },
  { slug: 'st-plazahouse', no: 'p003', name: 'シネマプラザハウス' },
  { slug: 'st-southernplex', no: 'p004', name: 'サザンプレックス' },
  { slug: 'st-mihama7plex', no: 'p005', name: 'ミハマ7プレックス' },
  { slug: 'st-rycom', no: 'p006', name: 'シネマライカム' },
];

export const isStarTheater = (th) => th.startsWith('st-');

const httpError = (status, message) => Object.assign(new Error(message), { status });

// CloudFront のキャッシュを避けるため、公式サイトと同じく ?v= を付ける
async function getJson(url) {
  const r = await fetch(`${url}?v=${new Date().toISOString()}`, {
    headers: { 'User-Agent': UA }, cache: 'no-store',
  });
  if (r.status === 404 || r.status === 403) return null; // 未公開の日付は S3 が 404 を返す
  if (!r.ok) throw httpError(502, `スケジュール取得に失敗 (HTTP ${r.status})`);
  return r.json();
}

export async function loadStar(th, d) {
  const theater = STAR_THEATERS.find((x) => x.slug === th);
  if (!theater) throw httpError(400, `劇場スラッグ ${th} は未対応`);
  const date = d.replace(/-/g, '');

  const index = await getJson(`${BASE}/schedule.json`);
  if (!index) throw httpError(502, 'スケジュール一覧が取得できなかった');

  // 公式サイトは「掲載開始前」の回を隠すが、ここでは隠さない（eventId を先に押さえるのが目的）
  const nos = Object.keys(index).filter((no) => index[no]?.[theater.no]?.[date]);
  const files = await Promise.all(nos.map((no) => getJson(`${BASE}/${no}/${theater.no}/${date}.json`)));

  const now = new Date();
  const events = {};
  const films = [];
  nos.forEach((no, i) => {
    // { 時刻HHMM: { スクリーンコード: 上映回 } }
    const evs = Object.values(files[i] || {}).flatMap((byScreen) => Object.values(byScreen));
    if (!evs.length) return;
    evs.sort((a, b) => a.startDate.localeCompare(b.startDate));
    events[no] = evs;
    films.push({ film: no, name: evs[0].name?.ja?.trim() || `作品${no}` });
  });

  return {
    films,
    screeningsOf: (film) => (events[film] || []).map((ev) => toScreening(ev, now)),
    jumpUrl: (hit) => TICKET_URL + hit.id,
  };
}

function toScreening(ev, now) {
  const o = ev.offers || {};
  const from = new Date(o.validFrom);
  const through = new Date(o.validThrough);
  const memFrom = new Date(o.validFromForMembers || o.validFrom);
  const memThrough = new Date(o.validThroughForMembers || o.validThrough);

  // validFrom〜validThrough が一般の購入可能期間。会員期間が前に張り出していれば会員先行
  const status = o.isOnlyWindowSale ? 'closed'
    : from <= now && now <= through ? 'onsale'
      : memFrom <= now && now <= memThrough ? 'presale'
        : now < from && now < memFrom ? 'before' : 'closed';

  // 空席記号は公式サイトの閾値（残り3割未満で△）に合わせる。
  // ※公式は車椅子席等の非販売席数を別データから差し引いているが、ここでは未反映（やや甘めに出る）
  const remain = ev.remainingAttendeeCapacity;
  const max = ev.maximumAttendeeCapacity;
  const seat = typeof remain !== 'number' ? null : remain <= 0 ? '×' : remain / max < 0.3 ? '△' : '○';

  // PLATINUM会員の最速先行。値は「,」区切りで [1]=開始日時 [3]=枚数上限 と読む
  // ※公式サイトJSの読み方からの推定（仮説）。実データでの確認はまだ
  const platinum = (ev.additionalProperty || [])
    .find((p) => p.name === 'platinumMemberConditions')?.value?.split(',') || [];

  return {
    time: hm(ev.startDate),
    end: hm(ev.endDate),
    screen: ev.location?.name?.ja || ev.location?.branchCode || '',
    id: ev.id,
    status,
    onSale: status === 'onsale' || status === 'presale',
    presale: status === 'presale',
    seat,
    remain: remain ?? null,
    max: max ?? null,
    saleStart: label(from),
    memberSaleStart: memFrom < from ? label(memFrom) : null,
    platinumFrom: platinum[1] && !isNaN(new Date(platinum[1])) ? label(new Date(platinum[1])) : null,
    platinumLimit: platinum[3] || null,
    windowOnly: !!o.isOnlyWindowSale,
    direct: TICKET_URL + ev.id,
  };
}

// Vercel は UTC で動くので JST を自前で組む
const WD = '日月火水木金土';
const jst = (s) => new Date(new Date(s).getTime() + 9 * 3600e3);
const hm = (s) => jst(s).toISOString().slice(11, 16);
const label = (s) => {
  const j = jst(s);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}(${WD[j.getUTCDay()]}) ${hm(s)}`;
};
