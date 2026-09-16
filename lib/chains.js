// 対応チェーンの登録表
//
// 劇場スラッグの接頭辞でチェーンを見分ける（接頭辞なし＝ユナイテッド・シネマ）。
//   st- スターシアターズ（沖縄）
//   cs- シネマサンシャイン（グランドシネマサンシャイン池袋を含む）
//   ae- イオンシネマ
// チェーンを増やすときは、ここに1件足して load を実装すれば go.js は触らなくていい。

import { scheduleDataLoader } from './scheduledata.js';
import { AEON_PREFIX, aeonTheaters, loadAeon } from './aeoncinema.js';

// --- スターシアターズ（沖縄6館）---
// no は公式サイトCMSの smart_theater_no（2026-09-15 取得）
const STAR_THEATERS = [
  { slug: 'st-cinemaq', no: 'p001', name: 'シネマQ' },
  { slug: 'st-palette', no: 'p002', name: 'シネマパレット' },
  { slug: 'st-plazahouse', no: 'p003', name: 'シネマプラザハウス' },
  { slug: 'st-southernplex', no: 'p004', name: 'サザンプレックス' },
  { slug: 'st-mihama7plex', no: 'p005', name: 'ミハマ7プレックス' },
  { slug: 'st-rycom', no: 'p006', name: 'シネマライカム' },
];

// --- シネマサンシャイン（16館）---
// no は公式サイトCMSの smart_theater_no（2026-09-16 取得）
const SUNSHINE_THEATERS = [
  { slug: 'cs-gdcs', no: '020', name: 'グランドシネマサンシャイン 池袋' },
  { slug: 'cs-heiwajima', no: '002', name: 'シネマサンシャイン平和島' },
  { slug: 'cs-tsuchiura', no: '013', name: 'シネマサンシャイン土浦' },
  { slug: 'cs-yukarigaoka', no: '019', name: 'シネマサンシャインユーカリが丘' },
  { slug: 'cs-misato', no: '023', name: 'シネマサンシャイン三郷' },
  { slug: 'cs-lalaportnumazu', no: '021', name: 'シネマサンシャインららぽーと沼津' },
  { slug: 'cs-kahoku', no: '014', name: 'シネマサンシャインかほく' },
  { slug: 'cs-yamatokoriyama', no: '016', name: 'シネマサンシャイン大和郡山' },
  { slug: 'cs-kitajima', no: '012', name: 'シネマサンシャイン北島' },
  { slug: 'cs-kinuyama', no: '008', name: 'シネマサンシャイン衣山' },
  { slug: 'cs-shigenobu', no: '009', name: 'シネマサンシャイン重信' },
  { slug: 'cs-masaki', no: '015', name: 'シネマサンシャイン エミフルMASAKI' },
  { slug: 'cs-shimonoseki', no: '017', name: 'シネマサンシャイン下関' },
  { slug: 'cs-iizuka', no: '022', name: 'シネマサンシャイン飯塚' },
  { slug: 'cs-aira', no: '018', name: 'シネマサンシャイン姶良' },
  { slug: 'cs-tomakomai', no: '033', name: 'シネマサンシャイン苫小牧' },
];

// シネマサンシャインは購入システムが2系統ある。
// 公式サイトJSの分岐（type==="core" のとき ticket-cinemasunshine.com → smart-theater.com、
// sskts → cinemasunshine に置換）を再現する。対象はこの4館だけで、他は置換なし。
const SUNSHINE_CORE = ['012', '014', '016', '023'];
const sunshineTicketUrl = (no, id) => (SUNSHINE_CORE.includes(no)
  ? `https://reserve.smart-theater.com/projects/cinemasunshine-production/purchase/transaction/${id}`
  : `https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/${id}`);

export const CHAINS = [
  {
    id: 'star',
    prefix: 'st-',
    label: 'スターシアターズ（沖縄）',
    theaters: async () => STAR_THEATERS.map(({ slug, name }) => ({ slug, name, chain: 'star', comingSoon: false })),
    load: scheduleDataLoader({
      base: 'https://startheaters.jp/schedule/data',
      theaters: STAR_THEATERS,
      ticketUrl: (_no, id) => `https://reserve.smart-theater.com/projects/startheaters-production/purchase/transaction/${id}`,
    }),
  },
  {
    id: 'sunshine',
    prefix: 'cs-',
    label: 'シネマサンシャイン',
    theaters: async () => SUNSHINE_THEATERS.map(({ slug, name }) => ({ slug, name, chain: 'sunshine', comingSoon: false })),
    load: scheduleDataLoader({
      base: 'https://www.cinemasunshine.co.jp/schedule/data',
      theaters: SUNSHINE_THEATERS,
      ticketUrl: sunshineTicketUrl,
    }),
  },
  {
    id: 'aeon',
    prefix: AEON_PREFIX,
    label: 'イオンシネマ',
    theaters: aeonTheaters,
    load: loadAeon,
  },
];

export const CHAIN_LABEL = {
  united: 'ユナイテッド・シネマ',
  ...Object.fromEntries(CHAINS.map((c) => [c.id, c.label])),
};

// 劇場スラッグからチェーンを引く。該当なし＝ユナイテッド・シネマ
export const resolveChain = (th) => CHAINS.find((c) => th.startsWith(c.prefix)) || null;

// 全チェーンの劇場一覧。1チェーンが落ちても他は返す
export async function chainTheaters() {
  const results = await Promise.all(CHAINS.map(async (c) => {
    try { return await c.theaters(); } catch { return []; }
  }));
  return results.flat();
}
