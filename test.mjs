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

// 0) 環境確認：Shift_JIS デコードが通るか
line('環境: Node ' + process.version);
try {
  const t = new TextDecoder('shift_jis').decode(new Uint8Array([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]));
  console.log('TextDecoder("shift_jis") →', t, t === 'テスト' ? '✅ OK' : '❌ 不一致');
} catch (e) {
  console.log('❌ Shift_JIS デコード不可:', e.message);
}

// 1) 作品一覧（7/31・販売前の日）
line('① 作品一覧 7/31');
{
  const r = await call({ th: 'urasoe', d: '2026-07-31', json: '1' });
  console.log('status:', r._status, '/ 作品数:', r._body?.films?.length);
  console.log(r._body?.films?.filter(f => f.name.includes('スパイダーマン')));
}

// 2) 作品名検索 → 上映回一覧（販売前なので onSale:false のはず）
line('② スパイダーマン IMAX 字幕 の上映回 7/31');
{
  const r = await call({ th: 'urasoe', d: '2026-07-31', q: 'スパイダーマン IMAX 字幕', json: '1' });
  console.log('status:', r._status, '/ film:', r._body?.film, r._body?.name);
  console.table(r._body?.screenings?.map(({ time, end, screen, status, seat, mc }) => ({ time, end, screen, status, seat, mc })));
  console.log('bookmark例:', r._body?.screenings?.[0]?.bookmark);
}

// 2.5) 3状態の区別（今日の回：終了済み=closed / 販売中=onsale が混在するはず）
line('②.5 状態判定 ちいかわIMAX 今日');
{
  const today = new Date().toISOString().slice(0, 10);
  const r = await call({ th: 'urasoe', d: today, q: 'ちいかわ IMAX', json: '1' });
  console.table(r._body?.screenings?.map(({ time, status, seat, mc }) => ({ time, status, seat, mc })));
}

// 3) 販売中の回 → 302 リダイレクトになるか（ちいかわIMAX 7/30 11:05）
line('③ 販売中の回にジャンプ ちいかわIMAX 7/30 11:05');
{
  const r = await call({ th: 'urasoe', d: '2026-07-30', q: 'ちいかわ IMAX', t: '11:05' });
  console.log('status:', r._status);
  console.log('redirect:', r._redirect || r._body);
}

// 4) 販売前の回を指定 → 503 で一覧が返るか
line('④ 販売前の回を指定 スパイダーマン 7/31 10:50');
{
  const r = await call({ th: 'urasoe', d: '2026-07-31', f: '22072', t: '10:50' });
  console.log('status:', r._status, '/', r._body?.error);
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
  const r = await call({ th: 'urasoe', d: '2026-07-31', f: '22072' });
  console.log('status:', r._status, '/ Content-Type:', r._headers['Content-Type']);
  console.log('length:', String(r._body).length, '/ 販売前表示:', String(r._body).includes('販売前'));
}

// ---------- スターシアターズ（シネマQ） ----------
// 購入開始は上映日2日前0:00（公式規約）なので、翌日＝販売中、3日後＝販売前 が期待値
const jstDate = (plus) => new Date(Date.now() + 9 * 3600e3 + plus * 86400e3).toISOString().slice(0, 10);

// 6) 作品一覧 → 上映回 → 販売中の回にジャンプ
line('⑥ シネマQ 作品一覧 ' + jstDate(1));
{
  const d = jstDate(1);
  const r = await call({ th: 'st-cinemaq', d, json: '1' });
  console.log('status:', r._status, '/ 作品数:', r._body?.films?.length, r._body?.error || '');
  console.log(r._body?.films?.slice(0, 5));

  const film = r._body?.films?.find((x) => !x.name.includes('メンバーズカード'))?.film;
  if (film) {
    line('⑦ シネマQ 上映回 film=' + film);
    const s = await call({ th: 'st-cinemaq', d, f: film, json: '1' });
    console.log(s._body?.name);
    console.table(s._body?.screenings?.map(({ time, end, screen, status, seat, remain, max, saleStart, id }) =>
      ({ time, end, screen, status, seat, remain, max, saleStart, id })));

    const hit = s._body?.screenings?.find((x) => x.status === 'onsale');
    line('⑧ シネマQ 販売中の回にジャンプ');
    if (hit) {
      const j = await call({ th: 'st-cinemaq', d, f: film, t: hit.time });
      console.log('status:', j._status, '/ Referrer-Policy:', j._headers['Referrer-Policy']);
      console.log('redirect:', j._redirect || j._body);
    } else {
      console.log('販売中の回がない（上映終了後の時間帯なら正常）');
    }
  }
}

// 9) 販売前の回を指定 → 503 と購入開始日時が返るか
line('⑨ シネマQ 販売前の回 ' + jstDate(3));
{
  const d = jstDate(3);
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

// 10) 劇場一覧にスターシアターズが入っているか
line('⑩ 劇場一覧 スターシアターズ');
{
  const { default: theaters } = await import('./api/theaters.js');
  const res = mockRes();
  await theaters({ query: {} }, res);
  console.log(res._body?.theaters?.filter((t) => t.chain === 'star'));
  console.log('error:', res._body?.error ?? 'なし');
}
