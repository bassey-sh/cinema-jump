// ローカル検証：実サイト相手に handler を叩いてパース結果を確認する
//   node test.mjs
import handler from './api/go.js';

const mockRes = () => ({
  _status: 200, _body: null, _redirect: null, _headers: {},
  status(c) { this._status = c; return this; },
  json(o) { this._body = o; return this; },
  send(s) { this._body = s; return this; },
  setHeader(k, v) { this._headers[k] = v; },
  redirect(c, u) { this._status = c; this._redirect = u; return this; },
});

const call = async (query) => {
  const res = mockRes();
  await handler({ query, headers: { host: 'cinema-jump.vercel.app' } }, res);
  return res;
};

const line = (s) => console.log('\n=== ' + s + ' ===');
const jstDate = (plus) => new Date(Date.now() + 9 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);

// 0) 環境確認：Shift_JIS デコードが通るか
line('環境: Node ' + process.version);
try {
  const t = new TextDecoder('shift_jis').decode(new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]));
  console.log('TextDecoder("shift_jis") →', t, t === 'テスト' ? '✅ OK' : '❌ 不一致');
} catch (e) {
  console.log('❌ Shift_JIS デコード不可:', e.message);
}

// 1) 作品一覧（7/31・販売前の日）
line('① 作品一覧 ユナイテッド浦添 ' + jstDate(1));
{
  const r = await call({ th: 'urasoe', d: jstDate(1), json: '1' });
  console.log('status:', r._status, '/ 作品数:', r._body?.films?.length);
  console.log(r._body?.films?.slice(0, 5));
}

// 2) 作品名検索 → 上映回一覧（販売前なので onSale:false のはず）
line('② 作品名検索（IMAX 字幕）の上映回 ' + jstDate(1));
{
  const r = await call({ th: 'urasoe', d: jstDate(1), q: 'IMAX 字幕', json: '1' });
  console.log('status:', r._status, '/ film:', r._body?.film, r._body?.name);
  console.table(r._body?.screenings?.map(({ time, end, screen, status, seat, mc }) => ({ time, end, screen, status, seat, mc })));
  console.log('bookmark例:', r._body?.screenings?.[0]?.bookmark);
}

// 2.5) 3状態の区別（今日の回：終了済み=closed / 販売中=onsale が混在するはず）
line('②.5 状態判定 今日のIMAX回');
{
  const r = await call({ th: 'urasoe', d: jstDate(0), q: 'IMAX 字幕', json: '1' });
  console.table(r._body?.screenings?.map(({ time, status, seat, mc }) => ({ time, status, seat, mc })));
}

// 3) 販売中の回 → 302 リダイレクトになるか（ちいかわIMAX 7/30 11:05）
line('③ 販売中の回にジャンプ（ユナイテッド浦添）');
{
  const list = await call({ th: 'urasoe', d: jstDate(1), json: '1' });
  const film = list._body?.films?.[0]?.film;
  const s = await call({ th: 'urasoe', d: jstDate(1), f: film, json: '1' });
  const hit = s._body?.screenings?.find((x) => x.onSale);
  if (hit) {
    const r = await call({ th: 'urasoe', d: jstDate(1), f: film, t: hit.time });
    console.log('status:', r._status);
    console.log('redirect:', r._redirect || r._body);
  } else console.log('販売中の回がない');
}

// 4) 販売前の回を指定 → 503 で一覧が返るか
line('④ 販売前の回を指定（ユナイテッド浦添 ' + jstDate(5) + '）');
{
  const list = await call({ th: 'urasoe', d: jstDate(5), json: '1' });
  const film = list._body?.films?.[0]?.film;
  if (!film) console.log('status:', list._status, '/', list._body?.error);
  else {
    const s = await call({ th: 'urasoe', d: jstDate(5), f: film, json: '1' });
    const before = s._body?.screenings?.find((x) => x.status === 'before');
    if (!before) console.log('販売前の回なし:', s._body?.screenings?.map((x) => x.status).join(','));
    else {
      const r = await call({ th: 'urasoe', d: jstDate(5), f: film, t: before.time });
      console.log('status:', r._status, '/', r._body?.error);
    }
  }
}

// 4.5) 劇場一覧APIが劇場名まで取れるか
line('④.5 劇場一覧API');
{
  const { default: theaters } = await import('./api/theaters.js');
  const res = mockRes();
  await theaters({ query: {} }, res);
  console.log('status:', res._status, '/ 劇場数:', res._body?.count);
  console.log('浦添:', res._body?.theaters?.find(t => t.slug === 'urasoe'));
  console.log('先頭3件:', res._body?.theaters?.slice(0, 3));
}

// 5) HTML 出力（スマホ表示用）が生成されるか
line('⑤ HTML出力');
{
  const list = await call({ th: 'urasoe', d: jstDate(1), json: '1' });
  const r = await call({ th: 'urasoe', d: jstDate(1), f: list._body?.films?.[0]?.film });
  console.log('status:', r._status, '/ Content-Type:', r._headers['Content-Type']);
  console.log('length:', String(r._body).length, '/ 販売前表示:', String(r._body).includes('販売前'));
}

// ---------- SMART THEATER 系チェーン（スターシアターズ／シネマサンシャイン／イオンシネマ） ----------
// 購入開始は各チェーンの規約次第（スター・サンシャインは上映日2日前0:00）。
// 翌日＝販売中、4日後＝販売前 になるのが期待値。
const chainSamples = [
  ['st-cinemaq', 'シネマQ'],
  ['cs-gdcs', 'グランドシネマサンシャイン池袋'],
  ['ae-', 'イオンシネマ（劇場一覧の先頭で置き換える）'],
  ['smt-marunouchi', '丸の内ピカデリー（旧方式）'],
  ['smt-miyoshi', 'MOVIX三好（新方式）'],
  ['c109-kiba', '109シネマズ木場'],
  ['tj-shinjuku_wald9', '新宿バルト9'],
  ['toho-081', 'TOHOシネマズ日比谷（購入はPOST）'],
];

// 6) 劇場一覧：チェーンごとの件数
line('⑥ 劇場一覧');
{
  const { default: theaters } = await import('./api/theaters.js');
  const res = mockRes();
  await theaters({ query: {} }, res);
  const byChain = {};
  for (const t of res._body?.theaters || []) (byChain[t.chain] ??= []).push(t);
  for (const [c, v] of Object.entries(byChain)) console.log(` ${c}: ${v.length}館`);
  console.log('error:', res._body?.error ?? 'なし');
  const aeon = byChain.aeon?.[0];
  if (aeon) chainSamples[2] = [aeon.slug, aeon.name];
}

// 7) 各チェーン：作品一覧 → 上映回 → 販売中の回にジャンプ
for (const [th, label] of chainSamples) {
  const d = jstDate(1);
  line(`⑦ ${label} ${d}`);
  const r = await call({ th, d, json: '1' });
  console.log('status:', r._status, '/ 作品数:', r._body?.films?.length, r._body?.error || '');
  const film = r._body?.films?.find((x) => !/メンバーズ|受付/.test(x.name));
  if (!film) continue;

  const s = await call({ th, d, f: film.film, json: '1' });
  console.log(' 作品:', s._body?.name, `(${film.film})`);
  console.table(s._body?.screenings?.slice(0, 5).map(({ time, end, screen, status, seat, saleStart, id }) =>
    ({ time, end, screen, status, seat, saleStart, id })));

  const hit = s._body?.screenings?.find((x) => x.status === 'onsale');
  if (hit) {
    const j = await call({ th, d, f: film.film, t: hit.time });
    console.log(' ジャンプ:', j._status, '/ Referrer-Policy:', j._headers['Referrer-Policy']);
    // TOHOはPOSTの自動送信フォーム（HTML）が返る
    console.log(' redirect:', j._redirect
      || `自動送信フォーム action=${(String(j._body).match(/action="([^"]+)"/) || [])[1]}`);
  } else {
    console.log(' 販売中の回がない（上映終了後の時間帯なら正常）');
  }
}

// 8) 販売前の回 → 503 と購入開始日時が返るか（シネマQの4日後）
line('⑧ シネマQ 販売前の回 ' + jstDate(4));
{
  const d = jstDate(4);
  const r = await call({ th: 'st-cinemaq', d, json: '1' });
  console.log('status:', r._status, '/ 作品数:', r._body?.films?.length, r._body?.error || '');
  const film = r._body?.films?.[0]?.film;
  if (film) {
    const s = await call({ th: 'st-cinemaq', d, f: film, json: '1' });
    const before = s._body?.screenings?.find((x) => x.status === 'before');
    if (before) {
      const j = await call({ th: 'st-cinemaq', d, f: film, t: before.time });
      console.log('status:', j._status, '/', j._body?.error);
      console.log('direct:', before.direct);
    } else {
      console.log('販売前の回なし:', s._body?.screenings?.map((x) => x.status));
    }
  }
}
