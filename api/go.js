// 座席選択ページ ダイレクトジャンプ
//
// 対応チェーン
//   ユナイテッド・シネマ : 販売開始と同時に生成される mc（購入システム側の作品ID）を
//                         上映スケジュールHTMLから抜き出して、座席選択ページへ 302 で飛ばす。
//   スターシアターズ     : 上映回ごとの eventId をスケジュールJSONから引いて飛ばす（lib/startheaters.js）
//
//   /api/go?th=urasoe&d=2026-07-31                        → その日の作品一覧
//   /api/go?th=urasoe&d=2026-07-31&q=スパイダー IMAX 字幕  → 上映回一覧＋ブックマーク用URL
//   /api/go?th=urasoe&d=2026-07-31&f=22072&t=10:50        → 販売中なら座席選択へ直行
//   /api/go?th=st-cinemaq&d=2026-09-17&f=15692&t=14:35    → スターシアターズ（シネマQ）も同じ形式
//
// &json=1 を付けると常に JSON で返る。

import { isStarTheater, loadStar } from '../lib/startheaters.js';

const UA = 'Mozilla/5.0 (compatible; cinema-jump/1.0)';

export default async function handler(req, res) {
  const { th = 'urasoe', d, q, f, t, json } = req.query;

  // --- 入力検証（パスに使うので緩く通さない） ---
  if (!/^[a-z0-9-]+$/.test(th)) return fail(res, 400, '劇場スラッグが不正');
  if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return fail(res, 400, 'd は YYYY-MM-DD で指定しろ');
  if (f && !/^\d+$/.test(f)) return fail(res, 400, 'f は数字');
  if (t && !/^\d{1,2}:\d{2}$/.test(t)) return fail(res, 400, 't は HH:MM で指定しろ');

  const origin = `https://${req.headers.host}`;
  const wantJson = json === '1';

  // --- チェーンごとにスケジュールを読む ---
  // src = { films, screeningsOf(film), jumpUrl(screening) }
  let src;
  try {
    src = isStarTheater(th) ? await loadStar(th, d) : await loadUnited(th, d);
  } catch (e) {
    return fail(res, e.status || 502, e.status ? e.message : `スケジュール取得に失敗: ${e.message}`);
  }
  const { films } = src;
  if (!films.length) return fail(res, 404, `${d} のスケジュールはまだ公開されていない`);

  // --- 対象作品の決定 ---
  let target;
  if (f) {
    target = films.find((x) => x.film === f);
    if (!target) return fail(res, 404, `film=${f} が ${d} に見当たらない`, { films });
  } else if (q) {
    const words = q.trim().split(/\s+/);
    const hits = films.filter((x) => words.every((w) => x.name.includes(w)));
    if (hits.length !== 1) {
      return fail(res, hits.length ? 300 : 404,
        hits.length ? '候補が絞りきれない。語を足すか f= で直接指定しろ' : '該当作品なし',
        { candidates: hits.length ? hits : films });
    }
    target = hits[0];
  } else {
    // 作品指定なし → 一覧を返す
    return ok(res, wantJson, { date: d, theater: th, films }, () => renderFilms(origin, th, d, films));
  }

  const screenings = src.screeningsOf(target.film).map((s) => ({
    ...s, bookmark: `${origin}/api/go?th=${th}&d=${d}&f=${target.film}&t=${s.time}`,
  }));

  // --- 時刻指定なし → 上映回一覧（ブックマーク用URL付き） ---
  if (!t) {
    return ok(res, wantJson, { ...target, date: d, theater: th, screenings },
      () => renderScreenings(th, d, target, screenings));
  }

  // --- 時刻指定あり → 販売中なら座席選択へ直行 ---
  const hit = screenings.find((s) => s.time === t || s.time === pad(t));
  if (!hit) {
    return fail(res, 404, `${t} の回が見つからない`, { screenings });
  }
  if (!hit.onSale) {
    const why = hit.status === 'before'
      ? (hit.saleStart ? `まだ販売前（${hit.saleStart} から購入可）` : 'まだ販売前（mc未生成）')
      : '販売対象外（上映済み・販売締切・満席のいずれか）';
    return fail(res, 503, `${why}：${target.name} ${d} ${t}`, { screenings });
  }
  // 外部サイト由来の遷移と判定されてトップへ飛ばされるのを避ける
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.redirect(302, src.jumpUrl(hit));
}

// ---------- ユナイテッド・シネマ ----------

async function loadUnited(th, d) {
  const sd = d.replace(/-/g, '');

  // --- スケジュールHTML取得（Shift_JIS） ---
  const r = await fetch(`https://www.unitedcinemas.jp/${th}/daily.php?date=${d}`, {
    headers: { 'User-Agent': UA }, cache: 'no-store',
  });
  if (!r.ok) throw Object.assign(new Error(`スケジュール取得に失敗 (HTTP ${r.status})`), { status: 502 });
  const html = new TextDecoder('shift_jis').decode(await r.arrayBuffer());

  // --- その日の全作品（上映方式ごとに別レコード） ---
  const films = [];
  const seen = new Set();
  for (const m of html.matchAll(/<a href="film\.php\?film=(\d+)[^"]*"[^>]*>([^<]+)<\/a>/g)) {
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    films.push({ film: m[1], name: decodeEntities(m[2].trim()) });
  }

  return { films, screeningsOf, jumpUrl };

  function screeningsOf(film) {
    // --- 対象作品ブロックを切り出す ---
    const i = html.indexOf(`film=${film}`);
    const j = html.indexOf('film.php?film=', i + 10);
    const block = html.slice(i, j < 0 ? undefined : j);

    // --- 販売中の回（購入リンクが生成されている＝mc 確定） ---
    // 通常販売   : /all/cc.php        → /pticket/schedule.php へ転送される
    // 会員先行販売: /clubspice/presale.php → そのまま叩く（CLUB-SPICE会員の先行期間）
    const sold = {};
    for (const m of block.matchAll(
      /\/(all\/cc|clubspice\/presale)\.php\?tc=(\d+)&(?:amp;)?sd=(\d+)&(?:amp;)?sc=(\d+)&(?:amp;)?st=(\d+)&(?:amp;)?mc=(\d+)/g)) {
      sold[m[5]] = { tc: m[2], sc: m[4], mc: m[6], presale: m[1].startsWith('clubspice') };
    }

    // --- スクリーンごとの上映回（販売前でも取得できる） ---
    // 状態は3種。「まだ売ってない」と「もう終わった」は別物なので区別する。
    //   onsale : cc.php が生成されている（＝mc確定・購入可）
    //   before : outside_sales_period アイコン（＝販売期間外。まだ売り出されていない）
    //   closed : btn_buy_disable（＝販売対象外。上映済み・締切・満席）
    const screenings = [];
    for (const seg of block.split(/<p class="screenNumber">/).slice(1)) {
      const sc = ((seg.match(/screen_(\d+)_s\.gif/) || [])[1] || '').padStart(3, '0');
      for (const cell of seg.split(/<li class="startTime">/).slice(1)) {
        const time = (cell.match(/^\s*(\d{1,2}:\d{2})/) || [])[1];
        if (!time) continue;
        const chunk = cell.slice(0, 1500); // 次の回のHTMLを巻き込まない範囲
        const end = (chunk.match(/<li class="endTime">\s*[～~]?\s*(\d{1,2}:\d{2})/) || [])[1] || '';
        const st = sd + time.replace(':', '') + '00';
        const hit = sold[st];
        const status = hit ? (hit.presale ? 'presale' : 'onsale')
          : /outside_sales_period/.test(chunk) ? 'before' : 'closed';
        screenings.push({
          time, end, screen: hit?.sc || sc, st, status,
          onSale: !!hit,
          seat: (chunk.match(/alt="\[([○△×□])\]"/) || [])[1] || null, // ○空席 △残少 ×満席 □対象外
          mc: hit?.mc ?? null, tc: hit?.tc ?? null, presale: !!hit?.presale,
        });
      }
    }
    return screenings;
  }

  function jumpUrl(hit) {
    // 通常販売は cc.php を入口にする。cc.php は Queue-it の待機列ゲートを通して
    // 必要な cookie を確立させてから schedule.php へ戻す役割を持つ。
    // schedule.php を直接叩くと cookie がなくトップページへ 302 される。
    // 会員先行期間中は presale.php を直接叩く（cc.php はまだ生成されていない）
    const path = hit.presale ? '/clubspice/presale.php' : '/all/cc.php';
    return `https://www.unitedcinemas.jp${path}`
      + `?tc=${hit.tc}&sd=${sd}&sc=${hit.screen}&st=${hit.st}&mc=${hit.mc}`;
  }
}

// ---------- helpers ----------

const pad = (t) => t.replace(/^(\d):/, '0$1:');

const decodeEntities = (s) => s
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(n));

const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function ok(res, wantJson, data, renderHtml) {
  if (wantJson) return res.status(200).json(data);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(renderHtml());
}

function fail(res, code, message, extra = {}) {
  return res.status(code).json({ error: message, ...extra });
}

const PAGE = (title, body) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
 body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#111;color:#eee;line-height:1.6}
 h1{font-size:17px;margin:0 0 14px}
 a{color:#6cf}
 table{border-collapse:collapse;width:100%;font-size:15px}
 td,th{border-bottom:1px solid #333;padding:9px 6px;text-align:left}
 th{color:#888;font-weight:400;font-size:13px}
 .on{color:#4d4}.off{color:#888}
 .go{display:inline-block;background:#2a6;color:#fff;padding:5px 12px;border-radius:5px;text-decoration:none}
 .bm{font-size:12px;color:#777;word-break:break-all}
</style>
<h1>${esc(title)}</h1>${body}`;

function renderFilms(origin, th, d, films) {
  const rows = films.map((f) =>
    `<tr><td><a href="/api/go?th=${th}&d=${d}&f=${f.film}">${esc(f.name)}</a></td>
     <td style="color:#777">${f.film}</td></tr>`).join('');
  return PAGE(`${th} ${d} の上映作品（${films.length}件）`,
    `<table><tr><th>作品・上映方式</th><th>film</th></tr>${rows}</table>`);
}

function renderScreenings(th, d, target, screenings) {
  if (!screenings.length) return PAGE(target.name, '<p>上映回が取得できなかった。</p>');
  const LABEL = { onsale: '販売中', presale: '会員先行', before: '販売前', closed: '対象外' };
  const rows = screenings.map((s) => `<tr>
    <td><b>${s.time}</b><br><span style="color:#777;font-size:12px">～${s.end}</span></td>
    <td>${esc(s.screen)}</td>
    <td class="${s.onSale ? 'on' : 'off'}">${LABEL[s.status] || '-'}${s.seat ? ` ${s.seat}` : ''}
        ${s.status === 'before' && s.saleStart ? `<br><span style="font-size:12px">${esc(s.saleStart)}〜</span>` : ''}</td>
    <td>${s.onSale ? `<a class="go" href="${esc(s.bookmark)}">座席へ</a>` : ''}
        <div class="bm">${esc(s.bookmark)}</div></td></tr>`).join('');
  return PAGE(`${target.name} / ${d}`,
    `<table><tr><th>開始</th><th>SCR</th><th>状態</th><th>ブックマーク用URL</th></tr>${rows}</table>
     <p style="color:#777;font-size:13px">※ 各行のURLをブックマークしておけば、販売開始後にタップするだけで座席選択画面へ飛ぶ。</p>`);
}
