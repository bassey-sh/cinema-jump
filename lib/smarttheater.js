// SMART THEATER 系チェーン（スターシアターズ／シネマサンシャイン／イオンシネマ）の共通処理
//
// これらは同じ購入基盤を使っていて、上映回データも schema.org 風の同じ形をしている。
//   id                          上映回ID（購入URLの末尾に付けるだけで座席選択に直行する）
//   offers.validFrom/Through    一般の購入可能期間
//   会員の購入可能期間          チェーンごとに置き場所が違うので、呼び出し側が解決して渡す
//   remaining/maximumAttendeeCapacity  残席・総席数
//
// 共通して重要なのは「上映回IDがスケジュール掲載の時点で確定している」こと。
// 販売開始前でも購入URLを組める（開くと各チェーンの『販売期間外』画面になる）。

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';

export const httpError = (status, message) => Object.assign(new Error(message), { status });

// CDNのキャッシュを避けるため、各公式サイトと同じく ?v= を付ける
export async function getJson(url) {
  const r = await fetch(`${url}?v=${new Date().toISOString()}`, {
    headers: { 'User-Agent': UA }, cache: 'no-store',
  });
  if (r.status === 404 || r.status === 403) return null; // 未公開の日付は 404
  if (!r.ok) throw httpError(502, `スケジュール取得に失敗 (HTTP ${r.status})`);
  return r.json();
}

// Vercel は UTC で動くので JST を自前で組む
const WD = '日月火水木金土';
const jst = (s) => new Date(new Date(s).getTime() + 9 * 3600e3);
export const hm = (s) => jst(s).toISOString().slice(11, 16);
export const label = (s) => {
  const j = jst(s);
  return `${j.getUTCMonth() + 1}/${j.getUTCDate()}(${WD[j.getUTCDay()]}) ${hm(s)}`;
};

// 「,」区切りの会員条件。[1]=開始日時 [3]=枚数上限
// （シネマサンシャインの実データ "2,2026-09-13T11:30:00.000Z,2026-09-16T08:50:00.000Z,2" で確認）
export function memberCondition(ev, name) {
  const v = (ev.additionalProperty || []).find((p) => p.name === name)?.value?.split(',');
  if (!v?.[1] || isNaN(new Date(v[1]))) return null;
  return { from: new Date(v[1]), limit: v[3] || null };
}

// 上映回を cinema-jump の共通形式に正規化する
//   member : { from, through } 会員先行の期間（なければ一般と同じ扱い）
//   direct : 購入画面のURL
export function toScreening(ev, now, { member, direct, platinum } = {}) {
  const o = ev.offers || {};
  const from = new Date(o.validFrom);
  const through = new Date(o.validThrough);
  const memFrom = member?.from ? new Date(member.from) : from;
  const memThrough = member?.through ? new Date(member.through) : through;

  const status = o.isOnlyWindowSale ? 'closed'
    : from <= now && now <= through ? 'onsale'
      : memFrom <= now && now <= memThrough ? 'presale'
        : now < from && now < memFrom ? 'before' : 'closed';

  // 空席記号は各公式サイトの閾値（残り3割未満で△）に合わせる。
  // ※公式は車椅子席等の非販売席を差し引いているが、ここでは未反映（やや甘めに出る）
  const remain = ev.remainingAttendeeCapacity;
  const max = ev.maximumAttendeeCapacity;
  const seat = typeof remain !== 'number' ? null : remain <= 0 ? '×' : remain / max < 0.3 ? '△' : '○';

  return {
    time: hm(ev.startDate),
    end: ev.endDate ? hm(ev.endDate) : '',
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
    platinumFrom: platinum?.from ? label(platinum.from) : null,
    platinumLimit: platinum?.limit ?? null,
    windowOnly: !!o.isOnlyWindowSale,
    direct,
  };
}
