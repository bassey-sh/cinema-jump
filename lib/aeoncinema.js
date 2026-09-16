// イオンシネマ（全国99館）アダプタ
//
// 公式サイトの上映回データは、劇場ごとに1本の静的JSONにまとまっている。
//   https://theater.aeoncinema.com/schedule/v2/data/{劇場スラッグ}/schedule.json
//   → { "YYYYMMDD": { "作品ID": [ 上映回, ... ] } }
// 購入は SMART THEATER（projectId=aeoncinema-production）。会員先行は memberOffers で別立て。
// 劇場マスタは https://www.aeoncinema.com/json/_theaters.json（地方別・設備フラグ付き）。
//
// 2026-09-16 実測：掲載は9〜10日先まで（特別上映はもっと先の回も出る）。販売開始前でも id は取れる。

import { getJson, httpError, toScreening } from './smarttheater.js';

const BASE = 'https://theater.aeoncinema.com/schedule/v2/data';
const MASTER = 'https://www.aeoncinema.com/json/_theaters.json';
const TICKET_URL = 'https://reserve.smart-theater.com/projects/aeoncinema-production/purchase/transaction/';

export const AEON_PREFIX = 'ae-';

// 劇場マスタはめったに変わらないので、実行中はメモリに持つ
let cache = null;
export async function aeonTheaters() {
  if (cache && Date.now() - cache.at < 6 * 3600e3) return cache.list;
  const master = await getJson(MASTER);
  if (!master) throw httpError(502, 'イオンシネマの劇場一覧が取得できなかった');
  const list = [];
  // マスタは 地方 → 都道府県 → 劇場の配列 という2段のネスト
  for (const [area, prefs] of Object.entries(master)) {
    for (const [pref, theaters] of Object.entries(prefs || {})) {
      for (const t of Object.values(theaters || {})) {
        if (!t?.facility_id) continue;
        list.push({
          slug: AEON_PREFIX + t.facility_id,
          name: `イオンシネマ${t.name}`,
          chain: 'aeon',
          area,
          pref,
          // chip は "4DX" "IMAXレーザー" 等の表示用タグ
          tags: (t.chip || []).filter(Boolean),
          comingSoon: false,
        });
      }
    }
  }

  cache = { at: Date.now(), list };
  return list;
}

export async function loadAeon(th, d) {
  const facility = th.slice(AEON_PREFIX.length);
  if (!/^[a-z0-9-]+$/.test(facility)) throw httpError(400, `劇場スラッグ ${th} は未対応`);
  const date = d.replace(/-/g, '');

  const schedule = await getJson(`${BASE}/${facility}/schedule.json`);
  if (!schedule) throw httpError(404, `劇場 ${th} のスケジュールが取得できなかった`);
  const day = schedule[date];
  if (!day) return { films: [], screeningsOf: () => [], jumpUrl: () => '' };

  const now = new Date();
  const films = [];
  for (const [film, evs] of Object.entries(day)) {
    if (!evs.length) continue;
    evs.sort((a, b) => a.startDate.localeCompare(b.startDate));
    films.push({ film, name: evs[0].name?.ja?.trim() || `作品${film}` });
  }

  return {
    films,
    screeningsOf: (film) => (day[film] || []).map((ev) => toScreening(ev, now, {
      member: ev.memberOffers && { from: ev.memberOffers.validFrom, through: ev.memberOffers.validThrough },
      direct: TICKET_URL + ev.id,
    })),
    jumpUrl: (hit) => TICKET_URL + hit.id,
  };
}
