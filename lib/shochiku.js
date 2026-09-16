// 松竹マルチプレックスシアターズ（MOVIX・ピカデリー・東劇：23館）アダプタ
//
// 日別スケジュールは静的HTML断片で配信されている（Ajaxで差し込む作り）。
//   https://www.smt-cinema.com/html/site/sp/schedule/s0200_{劇場コード}_{YYYYMMDD}_schedule_daily_movie_area.html
//
// 劇場ごとに購入システムが2系統ある（2026-09-16 時点で新10館・旧13館）。
//   新: data-event-id あり → SMART THEATER（projectId=shochikumultiplextheatres-production）
//   旧: id="0_{th}_{mo}_{sd}_{pe}_{sc}_{fl}" → ticket.smt-cinema.com/ticket/f0100.do
// どちらも販売開始前から上映回IDが確定している（＝事前に購入URLを組める）。
// 丸の内ピカデリー・新宿ピカデリーは旧方式。

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';
const PREFIX = 'smt-';
const BASE = 'https://www.smt-cinema.com/html/site/sp/schedule';
const NEW_TICKET = 'https://reserve.smart-theater.com/projects/shochikumultiplextheatres-production/purchase/transaction/';
const OLD_TICKET = 'https://ticket.smt-cinema.com/ticket/f0100.do';

const httpError = (status, message) => Object.assign(new Error(message), { status });

// 劇場コード（thnumber）は公式の theaterConst.json、名前は各劇場ページのタイトルから（2026-09-16）
export const SMT_THEATERS = [
  { slug: 'smt-marunouchi', no: '1052', name: '丸の内ピカデリー' },
  { slug: 'smt-shinjuku', no: '1051', name: '新宿ピカデリー' },
  { slug: 'smt-togeki', no: '1050', name: '東劇' },
  { slug: 'smt-saitama', no: '1022', name: 'MOVIXさいたま' },
  { slug: 'smt-kawaguchi', no: '1024', name: 'MOVIX川口' },
  { slug: 'smt-kameari', no: '1025', name: 'MOVIX亀有' },
  { slug: 'smt-akishima', no: '1026', name: 'MOVIX昭島' },
  { slug: 'smt-kashiwanoha', no: '1028', name: 'MOVIX柏の葉' },
  { slug: 'smt-hashimoto', no: '1021', name: 'MOVIX橋本' },
  { slug: 'smt-tsukuba', no: '1030', name: 'MOVIXつくば' },
  { slug: 'smt-isesaki', no: '1033', name: 'MOVIX伊勢崎' },
  { slug: 'smt-utsunomiya', no: '1020', name: 'MOVIX宇都宮' },
  { slug: 'smt-sendai', no: '1017', name: 'MOVIX仙台' },
  { slug: 'smt-shimizu', no: '1015', name: 'MOVIX清水' },
  { slug: 'smt-miyoshi', no: '1016', name: 'MOVIX三好' },
  { slug: 'smt-kyoto', no: '1032', name: 'MOVIX京都' },
  { slug: 'smt-yao', no: '1029', name: 'MOVIX八尾' },
  { slug: 'smt-amagasaki', no: '1031', name: 'MOVIXあまがさき' },
  { slug: 'smt-kurashiki', no: '1014', name: 'MOVIX倉敷' },
  { slug: 'smt-hiezu', no: '1012', name: 'MOVIX日吉津' },
  { slug: 'smt-shunan', no: '1011', name: 'MOVIX周南' },
  { slug: 'smt-hiroshima', no: '1035', name: 'MOVIX広島駅' },
  { slug: 'smt-kumamoto', no: '1034', name: '熊本ピカデリー' },
];

export const SMT_PREFIX = PREFIX;
export const smtTheaters = async () =>
  SMT_THEATERS.map(({ slug, name }) => ({ slug, name, chain: 'smt', comingSoon: false }));

// 座席状況は <span class="sheet ok">◎余裕あり</span> のクラスで表される
const SHEET = {
  ok: ['onsale', '○'],
  few: ['onsale', '△'],
  ng: ['closed', '×'],
  before: ['before', null],
  end: ['closed', null],
};

export async function loadSmt(th, d) {
  const theater = SMT_THEATERS.find((x) => x.slug === th);
  if (!theater) throw httpError(400, `劇場スラッグ ${th} は未対応`);
  const date = d.replace(/-/g, '');

  const r = await fetch(`${BASE}/s0200_${theater.no}_${date}_schedule_daily_movie_area.html`,
    { headers: { 'User-Agent': UA }, cache: 'no-store' });
  if (!r.ok) throw httpError(502, `スケジュール取得に失敗 (HTTP ${r.status})`);
  const html = await r.text();

  const blocks = [];
  for (const sec of html.split(/<section id="moviecode" class="/).slice(1)) {
    const film = (sec.match(/^(\d+)\s/) || [])[1];
    if (!film) continue;
    const h2 = (sec.match(/<h2>([\s\S]*?)<\/h2>/) || [])[1] || '';
    const name = decodeEntities(h2.replace(/<[^>]+>/g, ' ').replace(/（本編[^）]*）/g, '').trim().replace(/\s+/g, ' '));
    blocks.push({ film, name: name || `作品${film}`, html: sec });
  }

  return {
    films: blocks.map(({ film, name }) => ({ film, name })),
    screeningsOf: (film) => parse(blocks.find((b) => b.film === film)?.html || '', theater, date),
    jumpUrl: (hit) => hit.direct,
  };
}

function parse(block, theater, date) {
  const screenings = [];
  let screen = '';
  // <h3><a class="T1016S03">シアター３</a></h3> でスクリーン、<div class="inner ..."> が各回
  for (const chunk of block.split(/<h3>/).slice(1)) {
    screen = decodeEntities((chunk.match(/<a[^>]*>([^<]+)<\/a>/) || [])[1]?.trim() || '');
    for (const inner of chunk.split(/<div class="inner /).slice(1)) {
      const id = (inner.match(/id="([^"]+)"/) || [])[1];
      if (!id) continue;
      const time = (inner.match(/<p class="time"><span>(\d{1,2}:\d{2})<\/span>/) || [])[1];
      if (!time) continue;
      const end = (inner.match(/<p class="time"><span>[^<]*<\/span>\s*[～~]\s*(\d{1,2}:\d{2})/) || [])[1] || '';
      const sheet = (inner.match(/<span class="sheet ([a-z]+)"/) || [])[1] || '';
      const [status, seat] = SHEET[sheet] || ['closed', null];

      const eventId = (inner.match(/data-event-id="([^"]+)"/) || [])[1];
      let direct = null;
      if (eventId) {
        direct = NEW_TICKET + eventId;
      } else {
        // 0_{th}_{mo}_{sd}_{pe}_{sc}_{fl}
        const p = id.split('_');
        if (p.length >= 7) {
          direct = `${OLD_TICKET}?th=${p[1]}&mo=${p[2]}&sd=${p[3]}&pe=${p[4]}&sc=${p[5]}&fl=${p[6]}`;
        }
      }
      screenings.push({
        time, end, screen, status,
        onSale: status === 'onsale' && !!direct,
        seat, direct, id: eventId || id,
        saleStart: null, // 回ごとの販売開始日時はHTMLに出ない
        system: eventId ? 'smart-theater' : 'smt-legacy',
      });
    }
  }
  return screenings;
}

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n));
