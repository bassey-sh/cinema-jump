// 「/schedule/data」型チェーンの共通ローダー
//
// スターシアターズとシネマサンシャインは、公式サイトの作りもデータの形も同型。
//   {BASE}/schedule.json                          作品No → 劇場No → 日付 → 時刻 → [販売開始日時]（索引）
//   {BASE}/{作品No}/{劇場No}/{YYYYMMDD}.json      上映回本体（id・startDate・offers・残席）
// 違うのは BASE と購入URLの組み立て方だけなので、そこだけ設定で渡す。
//
// 公式サイトは掲載開始前の回をブラウザ側で隠すが、ここでは隠さない（上映回IDを先に押さえるのが目的）。

import { getJson, httpError, toScreening, memberCondition } from './smarttheater.js';

// config = { base, theaters: [{ slug, no, name }], ticketUrl(no, id) }
export function scheduleDataLoader(config) {
  return async function load(th, d) {
    const theater = config.theaters.find((x) => x.slug === th);
    if (!theater) throw httpError(400, `劇場スラッグ ${th} は未対応`);
    const date = d.replace(/-/g, '');

    const index = await getJson(`${config.base}/schedule.json`);
    if (!index) throw httpError(502, 'スケジュール一覧が取得できなかった');

    const nos = Object.keys(index).filter((no) => index[no]?.[theater.no]?.[date]);
    const files = await Promise.all(nos.map((no) => getJson(`${config.base}/${no}/${theater.no}/${date}.json`)));

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

    const url = (ev) => config.ticketUrl(theater.no, ev.id);

    return {
      films,
      screeningsOf: (film) => (events[film] || []).map((ev) => toScreening(ev, now, {
        member: {
          from: ev.offers?.validFromForMembers || ev.offers?.validFrom,
          through: ev.offers?.validThroughForMembers || ev.offers?.validThrough,
        },
        platinum: memberCondition(ev, 'platinumMemberConditions'),
        direct: url(ev),
      })),
      jumpUrl: (hit) => config.ticketUrl(theater.no, hit.id),
    };
  };
}
