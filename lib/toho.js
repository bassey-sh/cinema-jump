// TOHOシネマズ（72館）アダプタ
//
// 上映スケジュールは認証不要の公開JSON APIで取れる。
//   https://api2.tohotheater.jp/api/schedule/v2/schedule/{劇場コード}/TNPI3050J05?vg_cd={劇場コード}&show_day={YYYYMMDD}
//   → data[0].list[0].list[]（作品）… .list[]（上映回）
//
// ただし**購入だけはPOSTでしか入れない**。公式サイトも、購入ボタンで隠しフォームを作って
// hlo.tohotheater.jp へ submit している（scheduleUtils.js の purchaseTicket）。
// そのため jumpUrl は URL 文字列ではなく POST の指示を返し、api/go.js が自動送信フォームを返す。
//
// 販売開始は公式FAQ：一般は上映2日前0:00、TOHO-ONE会員は3日前21:00（会員先行はログインが要る）。
// 上映回の識別子（pf_no 等）は販売開始前から取れるが、購入画面に入れるのは販売開始後。

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';
const PREFIX = 'toho-';
const API = 'https://api2.tohotheater.jp/api/schedule/v2/schedule';
const PURCHASE = 'https://hlo.tohotheater.jp/net/ticket/{site_cd}/TNPI2040J03.do';

const httpError = (status, message) => Object.assign(new Error(message), { status });

// 劇場コードと名前は公式の劇場検索ページ（Shift_JIS）から取得（2026-09-16）
export const TOHO_THEATERS = [
  { slug: 'toho-089', no: '089', name: 'TOHOシネマズ すすきの' },
  { slug: 'toho-049', no: '049', name: 'TOHOシネマズ おいらせ下田' },
  { slug: 'toho-050', no: '050', name: 'TOHOシネマズ 秋田' },
  { slug: 'toho-078', no: '078', name: 'TOHOシネマズ 仙台' },
  { slug: 'toho-081', no: '081', name: 'TOHOシネマズ 日比谷' },
  { slug: 'toho-076', no: '076', name: 'TOHOシネマズ 新宿' },
  { slug: 'toho-084', no: '084', name: 'TOHOシネマズ 池袋' },
  { slug: 'toho-073', no: '073', name: 'TOHOシネマズ 日本橋' },
  { slug: 'toho-080', no: '080', name: 'TOHOシネマズ 上野' },
  { slug: 'toho-009', no: '009', name: 'TOHOシネマズ 六本木ヒルズ' },
  { slug: 'toho-043', no: '043', name: 'TOHOシネマズ 渋谷' },
  { slug: 'toho-090', no: '090', name: 'TOHOシネマズ 大井町' },
  { slug: 'toho-040', no: '040', name: 'TOHOシネマズ 西新井' },
  { slug: 'toho-006', no: '006', name: 'TOHOシネマズ 南大沢' },
  { slug: 'toho-012', no: '012', name: 'TOHOシネマズ 府中' },
  { slug: 'toho-085', no: '085', name: 'TOHOシネマズ 立川立飛' },
  { slug: 'toho-029', no: '029', name: 'TOHOシネマズ 錦糸町（楽天地・オリナス）' },
  { slug: 'toho-018', no: '018', name: 'TOHOシネマズ ららぽーと船橋' },
  { slug: 'toho-003', no: '003', name: 'TOHOシネマズ 市川コルトンプラザ' },
  { slug: 'toho-077', no: '077', name: 'TOHOシネマズ 柏' },
  { slug: 'toho-028', no: '028', name: 'TOHOシネマズ 八千代緑が丘' },
  { slug: 'toho-035', no: '035', name: 'TOHOシネマズ 流山おおたかの森' },
  { slug: 'toho-071', no: '071', name: 'TOHOシネマズ 市原' },
  { slug: 'toho-007', no: '007', name: 'TOHOシネマズ 海老名' },
  { slug: 'toho-008', no: '008', name: 'TOHOシネマズ 小田原' },
  { slug: 'toho-010', no: '010', name: 'TOHOシネマズ 川崎' },
  { slug: 'toho-036', no: '036', name: 'TOHOシネマズ ららぽーと横浜' },
  { slug: 'toho-066', no: '066', name: 'TOHOシネマズ 上大岡' },
  { slug: 'toho-075', no: '075', name: 'TOHOシネマズ ららぽーと富士見' },
  { slug: 'toho-015', no: '015', name: 'TOHOシネマズ 宇都宮' },
  { slug: 'toho-024', no: '024', name: 'TOHOシネマズ ひたちなか' },
  { slug: 'toho-025', no: '025', name: 'TOHOシネマズ 水戸内原' },
  { slug: 'toho-067', no: '067', name: 'TOHOシネマズ 甲府' },
  { slug: 'toho-091', no: '091', name: 'TOHOシネマズ 名古屋栄' },
  { slug: 'toho-079', no: '079', name: 'TOHOシネマズ 赤池' },
  { slug: 'toho-026', no: '026', name: 'TOHOシネマズ 津島' },
  { slug: 'toho-021', no: '021', name: 'TOHOシネマズ 東浦' },
  { slug: 'toho-016', no: '016', name: 'TOHOシネマズ 木曽川' },
  { slug: 'toho-004', no: '004', name: 'TOHOシネマズ 浜松' },
  { slug: 'toho-039', no: '039', name: 'TOHOシネマズ サンストリート浜北' },
  { slug: 'toho-065', no: '065', name: 'TOHOシネマズ ららぽーと磐田' },
  { slug: 'toho-020', no: '020', name: 'TOHOシネマズ 岐阜' },
  { slug: 'toho-030', no: '030', name: 'TOHOシネマズ モレラ岐阜' },
  { slug: 'toho-053', no: '053', name: 'TOHOシネマズ ファボーレ富山' },
  { slug: 'toho-054', no: '054', name: 'TOHOシネマズ 高岡' },
  { slug: 'toho-068', no: '068', name: 'TOHOシネマズ 上田' },
  { slug: 'toho-037', no: '037', name: 'TOHOシネマズ 梅田' },
  { slug: 'toho-032', no: '032', name: 'TOHOシネマズ なんば（本館・別館）' },
  { slug: 'toho-005', no: '005', name: 'TOHOシネマズ 泉北' },
  { slug: 'toho-045', no: '045', name: 'TOHOシネマズ 鳳' },
  { slug: 'toho-072', no: '072', name: 'TOHOシネマズ くずはモール' },
  { slug: 'toho-086', no: '086', name: 'TOHOシネマズ セブンパーク天美' },
  { slug: 'toho-088', no: '088', name: 'TOHOシネマズ ららぽーと門真' },
  { slug: 'toho-023', no: '023', name: 'TOHOシネマズ 二条' },
  { slug: 'toho-064', no: '064', name: 'TOHOシネマズ 西宮OS' },
  { slug: 'toho-038', no: '038', name: 'TOHOシネマズ 伊丹' },
  { slug: 'toho-013', no: '013', name: 'TOHOシネマズ 橿原' },
  { slug: 'toho-031', no: '031', name: 'TOHOシネマズ 岡南' },
  { slug: 'toho-019', no: '019', name: 'TOHOシネマズ 緑井' },
  { slug: 'toho-017', no: '017', name: 'TOHOシネマズ 高知' },
  { slug: 'toho-048', no: '048', name: 'TOHOシネマズ 新居浜' },
  { slug: 'toho-087', no: '087', name: 'TOHOシネマズ ららぽーと福岡' },
  { slug: 'toho-056', no: '056', name: 'TOHOシネマズ 天神・ソラリア館' },
  { slug: 'toho-069', no: '069', name: 'TOHOシネマズ 福津' },
  { slug: 'toho-022', no: '022', name: 'TOHOシネマズ 直方' },
  { slug: 'toho-046', no: '046', name: 'TOHOシネマズ 長崎' },
  { slug: 'toho-083', no: '083', name: 'TOHOシネマズ 熊本サクラマチ' },
  { slug: 'toho-014', no: '014', name: 'TOHOシネマズ 光の森' },
  { slug: 'toho-027', no: '027', name: 'TOHOシネマズ はません' },
  { slug: 'toho-057', no: '057', name: 'TOHOシネマズ 宇城' },
  { slug: 'toho-055', no: '055', name: 'TOHOシネマズ 大分わさだ' },
  { slug: 'toho-074', no: '074', name: 'TOHOシネマズ アミュプラザおおいた' },
];

export const TOHO_PREFIX = PREFIX;
export const tohoTheaters = async () =>
  TOHO_THEATERS.map(({ slug, name }) => ({ slug, name, chain: 'toho', comingSoon: false }));

// unsoldSeatStatus は scheduleUtils.js の Status 定義に対応
//   A=余裕あり B=販売中 C=残りわずか D=売り切れ G=販売期間外
const STATUS = {
  A: ['onsale', '○'],
  B: ['onsale', '○'],
  C: ['onsale', '△'],
  D: ['closed', '×'],
  G: ['before', null],
};

export async function loadToho(th, d) {
  const theater = TOHO_THEATERS.find((x) => x.slug === th);
  if (!theater) throw httpError(400, `劇場スラッグ ${th} は未対応`);
  const date = d.replace(/-/g, '');

  const url = `${API}/${theater.no}/TNPI3050J05?__type__=html&vg_cd=${theater.no}&show_day=${date}`
    + `&isMember=&enter_kbn=&_dc=${Date.now()}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA }, cache: 'no-store' });
  if (!r.ok) throw httpError(502, `スケジュール取得に失敗 (HTTP ${r.status})`);
  const json = await r.json();

  const movies = json?.data?.[0]?.list?.[0]?.list || [];
  const films = movies.map((m) => ({ film: String(m.code), name: (m.name || '').trim() || `作品${m.code}` }));

  const screeningsOf = (film) => {
    const m = movies.find((x) => String(x.code) === film);
    return (m?.list || []).map((ev) => {
      const [status, seat] = STATUS[ev.unsoldSeatInfo?.unsoldSeatStatus] || ['closed', null];
      const scr = ev.screen || {};
      return {
        time: pad(ev.showingStart || ''),
        end: pad(ev.showingEnd || ''),
        // スクリーン名にIMAXレーザー等の表記が付くことがある
        screen: [scr.name, scr.iconNm2].filter(Boolean).join(' '),
        status,
        onSale: status === 'onsale',
        seat,
        id: String(ev.code),
        saleStart: null, // 回ごとの販売開始日時はAPIに出ない（一般は上映2日前0:00）
        // 購入はPOSTなので、押さえておくべき値をそのまま持たせる
        post: {
          method: 'POST',
          action: PURCHASE.replace('{site_cd}', theater.no),
          fields: {
            site_cd: theater.no,
            jyoei_date: date,
            gekijyo_cd: scr.theaterCd || '',
            screen_cd: scr.code || '',
            sakuhin_cd: String(m.code),
            pf_no: String(ev.code),
            fnc: '1',
            pageid: '2000J01',
            enter_kbn: '',
          },
        },
        direct: null, // GETで開ける購入URLは存在しない
      };
    });
  };

  return { films, screeningsOf, jumpUrl: (hit) => hit.post };
}

const pad = (t) => t.replace(/^(\d):/, '0$1:');
