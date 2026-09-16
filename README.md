# cinema-jump

映画館の**座席選択ページへ直行する**リダイレクタ。
上映スケジュールページを経由せず、スマホからワンタップで購入画面へ飛ぶ。

| チェーン | スラッグ | 劇場 | 事前にURLを押さえられるか |
|---|---|---|---|
| ユナイテッド・シネマ | （接頭辞なし） | 40館 | ✕（販売開始後に mc を抜く。2026-07-28 実戦投入済み） |
| スターシアターズ（沖縄） | `st-` | 6館 | **○** |
| シネマサンシャイン | `cs-` | 16館 | **○** |
| イオンシネマ | `ae-` | 99館 | **○** |
| 松竹（MOVIX・ピカデリー・東劇） | `smt-` | 23館 | **○** |
| 109シネマズ | `c109-` | 19館 | ✕（販売開始後に購入リンクが出る） |
| T・ジョイ（新宿バルト9 ほか） | `tj-` | 3館 | ✕（掲載＝販売開始。当日＋2日先まで） |
| TOHOシネマズ | `toho-` | 72館 | △（識別子は先に取れるが、購入がPOSTなので1タップ挟まる） |

合計278館。実戦投入済みはユナイテッド・シネマのみで、他は実データでのテストのみ。

以下「なぜ必要か」〜「購入エンドポイント」はユナイテッド・シネマの話。他チェーンは[SMART THEATER 系](#smart-theater-系スターシアターズシネマサンシャインイオンシネマ)を参照。

## なぜ必要か

購入URLは5つのパラメータでできている。

```
https://www.unitedcinemas.jp/pticket/schedule.php?tc=049&sd=20260730&sc=001&st=20260730110500&mc=24887
```

| パラメータ | 意味 | 販売開始前に分かるか |
|---|---|---|
| `tc` | 劇場コード（浦添=049） | ✅ |
| `sd` | 上映日 | ✅ |
| `sc` | スクリーン番号 | ✅ HTMLの `screen_01_s.gif` から |
| `st` | 上映開始日時 | ✅ HTMLの `class="startTime"` から |
| `mc` | 購入システム側の作品ID | ❌ **販売開始と同時に生成される** |

`mc` だけが事前取得できない（省略も偽装も不可。省くとトップページへ飛ばされる）。
このツールは**販売開始直後のHTMLから `mc` を抜き、そのまま購入画面へ302で飛ばす**。

### ID体系（重要）

サイトには**2系統のID**がある。混同すると動かない。

| ID | 用途 | 例 |
|---|---|---|
| `film` | サイト表示用の作品ID。**販売開始前から存在する** | `22072` |
| `mc` | 購入システム（U-ONLINE）側の作品ID。**販売開始と同時に生成** | `24904` |

どちらも「劇場 × 作品 × 上映方式」ごとの値で、**日付も時刻もまたいで不変**。
IMAX版・通常版・字幕・吹替はそれぞれ別IDを持つ。

**`film` から `mc` は計算できない。** 両者の差分は 2779〜2834 の幅で単調ですらない
（後から追加された特別上映が採番順を乱す）。実際 `film=22072` の `mc` を差分から
24906〜24912 と予測したが、**実測は 24904 で外れた**。予測に頼らないこと。

### 購入エンドポイントは2種類ある

**ここが最大の落とし穴。** 販売フェーズによってリンクの形式が変わる。

| フェーズ | HTMLに現れるリンク | 飛ばすべき先 |
|---|---|---|
| CLUB-SPICE会員先行 | `/clubspice/presale.php?...` | そのまま `presale.php` |
| 通常販売 | `/all/cc.php?...` | そのまま `cc.php`（**`schedule.php` に飛ばすな**） |

`cc.php` だけを見ていると、**会員先行期間中は「販売前」と誤判定する**。

### 通常販売では `schedule.php` を直接叩いてはいけない

最終的な座席選択ページは `/pticket/schedule.php` だが、**そこへ直接飛ばすとトップページへ 302 される**。
`cc.php` は単なる転送ではなく、**Queue-it の待機列ゲートを通して cookie を確立させる入口**だからだ。

実測した遷移（2026-09-01・9/3上映の回で確認）：

```
/all/cc.php?...            302 → unitedcinemas.queue-it.net（待機列判定）
queue-it.net               302 → /all/cc.php?...&queueittoken=...
/all/cc.php?...&token      302 → /all/cc.php?...（cookie 発行済み）
/all/cc.php?...            302 → /pticket/schedule.php?...  ← ここで初めて到達できる
```

この間に `QueueITAccepted-*` ほか複数の cookie が発行される。
これを持たずに `schedule.php` を叩くと `https://www.unitedcinemas.jp/index.html` へ飛ばされる。

会員先行（`presale.php`）はこのゲートを通らないため、そのまま叩いてよい。
**2026-07-28 の実戦は会員先行フェーズだったので、この地雷を踏まずに済んでいた。**

## SMART THEATER 系（スターシアターズ／シネマサンシャイン／イオンシネマ）

この3チェーンは同じ購入基盤（SMART THEATER）を使っていて、**仕組みはユナイテッド・シネマとまったく違う**。
共通処理は `lib/smarttheater.js`、チェーンの登録は `lib/chains.js` にまとまっている。

### 3チェーンに共通する最大の利点

**上映回IDはスケジュール掲載と同時に確定している。** 販売開始を待たずに購入URLを組めるので、
「販売開始前に直URLを確保 → 0:00に再読み込み」という戦い方ができる。販売前に開くと各チェーンの「販売期間外」画面になる。

### スターシアターズ（シネマQ ほか）

2026-09-15 に公式サイトのJSを解析して対応した。

### データの在りか

公式サイト（startheaters.jp）は Nuxt の静的サイトで、HTMLには上映回が書かれていない。ブラウザが静的JSONを読んで組み立てている。

| URL | 中身 |
|---|---|
| `/schedule/data/schedule.json` | `作品No → 劇場No → 日付 → 時刻 → [販売開始日時]` の索引。eventId は入っていない |
| `/schedule/data/{作品No}/{劇場No}/{YYYYMMDD}.json` | 上映回本体。`id`（eventId）・開始/終了・スクリーン・残席・`offers`（販売期間） |

- CloudFront のキャッシュを避けるため、公式と同じく `?v=現在時刻` を付けて取る
- まだ公開されていない日付は **404**

劇場No（公式CMSの `smart_theater_no`）：

| slug（このツール） | 劇場No | 劇場 |
|---|---|---|
| `st-cinemaq` | `p001` | シネマQ |
| `st-palette` | `p002` | シネマパレット |
| `st-plazahouse` | `p003` | シネマプラザハウス |
| `st-southernplex` | `p004` | サザンプレックス |
| `st-mihama7plex` | `p005` | ミハマ7プレックス |
| `st-rycom` | `p006` | シネマライカム |

### 購入URL

購入システムは SMART THEATER。**eventId を末尾に付けるだけ**で座席選択画面に直行する。

```
https://reserve.smart-theater.com/projects/startheaters-production/purchase/transaction/{eventId}
```

実測（2026-09-15）：

| 開いた回 | 結果 |
|---|---|
| 販売中 | 302 → SPA → **ログインも待機列もなしで座席選択画面**（取引期限15分のタイマーが動き出す） |
| 販売前 | 「販売期間外　ご指定のチケットは、現在販売期間外となっております。」 |

### ユナイテッド・シネマとの決定的な違い

**eventId はスケジュール掲載と同時に確定している。** 販売開始を待たずに購入URLを組める。
つまり、**販売開始前に直URLを手に入れておき、0:00になったら再読み込みするだけ**でいい。このツールを経由する必要すらない（UIの「直URLコピー」）。

### 販売期間

- **オンライン購入は上映日の2日前 0:00 から**。公式のオンライン利用規約に明記されている（「一部作品・上映により異なる場合がございます」の但し書きあり）
- 実データでも一致：シネマQの9/15〜17上映分45回がすべて「2日前0:00」だった
- スケジュールの掲載は数日分まとめて行われる（9/15〜17上映分は 9/11 14:00 に一斉掲載）
- JSONの `offers.validFrom`〜`validThrough` が一般の購入期間、`validFromForMembers`〜 が会員の購入期間。通常作品は同時刻だった

| status | 判定 |
|---|---|
| `onsale` | `validFrom ≦ 現在 ≦ validThrough` |
| `presale` | 会員期間だけに入っている |
| `before` | どちらの期間もまだ始まっていない（`saleStart` に購入開始日時が入る） |
| `closed` | 期間終了、または `isOnlyWindowSale`（窓口のみ） |

### 未検証・仮説

- **大作の初日に待機列が出るか**は未確認。今日（平日）の通常作品では出なかった
- **PLATINUM会員の最速先行**：`additionalProperty` の `platinumMemberConditions` を「,」区切りで `[1]=開始日時`・`[3]=枚数上限` と読む。同じ SMART THEATER 系のシネマサンシャインの実データで裏付け済み（スターシアターズ自体の実値はまだ見ていない）
- 空席記号の △（残り3割未満）は公式の閾値に合わせたが、公式は車椅子席など非販売席を別データから差し引いている。ここでは未反映なのでやや甘めに出る

### シネマサンシャイン（グランドシネマサンシャイン池袋 ほか）

2026-09-16 対応。**データの形はスターシアターズと同型**（`/schedule/data/` 配下の索引＋作品別JSON）なので、
ローダーは `lib/scheduledata.js` に共通化して、BASEと購入URLの組み立てだけ差し替えている。

- 購入システムは2系統。通常は `https://transaction.ticket-cinemasunshine.com/projects/sskts-production/purchase/transaction/{id}`
- 北島(012)・かほく(014)・大和郡山(016)・三郷(023) の4館だけ `https://reserve.smart-theater.com/projects/cinemasunshine-production/...`（公式サイトJSの置換分岐を再現）
- 販売開始は公式FAQ記載：**一般が上映日2日前0:00、PLATINUM会員が3日前20:30、BRONZE・GOLD会員が3日前21:00**。データの値とも一致
- グラシネのIMAX・4DX・BESTIA等はスクリーン名（`シアター12 IMAX2D.`）と作品名（`【IMAXレーザーGT字幕】`）に出る
- `platinumMemberConditions` の実データ `"2,2026-09-13T11:30:00.000Z,2026-09-16T08:50:00.000Z,2"` を確認。**「,」区切りの[1]が開始日時・[3]が枚数上限**という読み方はこれで裏付けた

### イオンシネマ（全国99館）

2026-09-16 対応。**劇場ごとに1本のJSONで完結する**ので、3チェーンの中でいちばん取得が軽い。

| URL | 中身 |
|---|---|
| `https://www.aeoncinema.com/json/_theaters.json` | 劇場マスタ。地方 → 都道府県 → 劇場の2段ネスト。`chip` に "IMAXレーザー" "4DX" 等のタグ |
| `https://theater.aeoncinema.com/schedule/v2/data/{劇場}/schedule.json` | `{ "YYYYMMDD": { "作品ID": [上映回...] } }` |

- 購入URLは `https://reserve.smart-theater.com/projects/aeoncinema-production/purchase/transaction/{id}`
- **会員先行は `memberOffers` に別立て**（他2チェーンは `offers.validFromForMembers`）。実測では一般が上映日2日前0:00、会員がその前日18:00
- 掲載は9〜10日先まで。特別上映はもっと先の回も出る
- 作品IDが英数字（`fmq6ie17k`）なので、`f=` の検証は数字限定にできない

### 松竹マルチプレックスシアターズ（MOVIX・ピカデリー・東劇）

2026-09-16 対応。**劇場ごとに新旧2つの購入システムが混在**している（新10館・旧13館）。

- スケジュールは静的HTML断片：`https://www.smt-cinema.com/html/site/sp/schedule/s0200_{劇場コード}_{YYYYMMDD}_schedule_daily_movie_area.html`
- 新方式：`data-event-id` あり → SMART THEATER（`projectId=shochikumultiplextheatres-production`）
- 旧方式：`id="0_{th}_{mo}_{sd}_{pe}_{sc}_{fl}"` → `https://ticket.smt-cinema.com/ticket/f0100.do?th=&mo=&sd=&pe=&sc=&fl=`
- **丸の内ピカデリー・新宿ピカデリーは旧方式**。丸の内の Dolby Cinema 上映は作品名に【DolbyCinema】が付く
- どちらも販売開始前から上映回IDが確定している

## 販売後にしか取れないチェーン

### 109シネマズ

2026-09-16 対応。ユナイテッド・シネマと同じ型で、購入リンクは販売開始まで HTML に出ない。

- スケジュール：`https://109cinemas.net/{スラッグ}/schedules/{YYYYMMDD}.html?theater_code={劇場コード}`（UTF-8・認証不要）
- 購入：`https://cinema.109cinemas.net/cgi-bin/pc/resv/resv_shw_ppt.cgi?ttc=&tsc=&tssc=&ymd=&cs=&stt=`
  - 2026-09-16 実測：302も挟まず、ログインも待機列もなしで「座席選択」ページ（EUC-JP）が返る
- 劇場コードは数字とは限らない（川崎=`I1`、二子玉川=`T1`）
- 販売開始（公式のお知らせ）：一般は上映2日前0:00、シネマポイント会員は3日前21:00
- 高崎はページが500、プレミアム新宿はこの方式のスケジュールを持たないため未対応

### T・ジョイ（新宿バルト9 ほか）

2026-09-16 対応。**掲載＝販売開始**で、スケジュールは当日＋2日先までしか出ない。

- 当日分は劇場トップに直書き。他の日付は CSRF トークン＋Cookie 付きの POST
  `POST https://tjoy.jp/theaterTop/scheduleGetHtmlApi` に `data={"date":"YYYY-MM-DD","theaterId":"140"}`
- トークンは劇場トップの `<meta name="csrf-token">` にある
- 購入：`https://tjoy.jp/{スラッグ}/reservation/index/{上映回ID}/{作品コード}/{スクリーン}/{日付}?type=film`（GETで座席選択へ）
- 劇場IDを取得済みなのは3館（バルト9=140・PRINCE品川=180・博多=550）。残り16館は未取得
- 応答に Queue-it のコネクタが常に付いている。混雑時に待機列が出るかは**未検証**

### TOHOシネマズ

2026-09-16 対応。**このツールで唯一、302で飛ばせないチェーン。**

- スケジュールは認証不要の公開JSON API：
  `https://api2.tohotheater.jp/api/schedule/v2/schedule/{劇場コード}/TNPI3050J05?vg_cd={劇場コード}&show_day={YYYYMMDD}`
  - `data[0].list[0].list[]`（作品）→ `.list[]`（上映回）。`screen.iconNm2` に「IMAXレーザー」等が入る
  - 空席は `unsoldSeatInfo.unsoldSeatStatus`：A=余裕 B=販売中 C=残少 D=売切 G=販売期間外
- **購入はPOSTでしか入れない。** 公式サイトも隠しフォームを作って submit している（`scheduleUtils.js` の `purchaseTicket`）
  ```
  POST https://hlo.tohotheater.jp/net/ticket/{site_cd}/TNPI2040J03.do
    site_cd, jyoei_date, gekijyo_cd, screen_cd, sakuhin_cd, pf_no, fnc=1, pageid=2000J01, enter_kbn
  ```
  そのため `jumpUrl()` はURL文字列ではなくPOSTの指示を返し、`api/go.js` が**自動送信フォームのページ**を返す
- 2026-09-16 実測：送信すると「TOHO-ONE会員入会促進」画面に着き、**「ログインせずに購入する」を1回押す**と座席選択へ進む（公式サイト経由でも同じ画面を通る）
- 販売開始（公式FAQ）：一般は上映2日前0:00、TOHO-ONE会員は3日前21:00

## チェーンを追加するには

1. `lib/{チェーン名}.js` に `load(th, d)` を書く。返すのは `{ films, screeningsOf(film), jumpUrl(screening) }`
   - `jumpUrl()` はURL文字列を返せばよい。POSTでしか入れないチェーンは
     `{ method: 'POST', action, fields }` を返すと自動送信フォームが使われる（TOHOの例）
2. `lib/chains.js` の `CHAINS` に `{ id, prefix, label, theaters, load }` を1件足す
3. `api/go.js` と `public/index.html` は触らなくていい（接頭辞で自動的に振り分ける）

SMART THEATER 系なら `lib/smarttheater.js` の `toScreening()` を使えば、状態判定・空席記号・日時表示はそろう。

## 使い方

### ブラウザで操作する（推奨）

```
https://<your-app>.vercel.app/
```

劇場（8チェーン278館からチェーン別に選択・記憶される）→ 日付 → 作品 → 上映回、とタップで辿れる。
各回に販売状態・空席状況・購入開始日時・「座席選択へ」「URLをコピー」「直URLコピー」が並ぶ。

### URLを直接叩く

```
/api/go?th=urasoe&d=2026-07-31                        → その日の作品一覧
/api/go?th=urasoe&d=2026-07-31&q=スパイダーマン IMAX 字幕 → 上映回一覧＋ブックマーク用URL
/api/go?th=urasoe&d=2026-07-31&f=22072&t=10:50        → 販売中なら購入画面へ直行
/api/go?th=st-cinemaq&d=2026-09-17&f=15692&t=14:35    → スターシアターズ（シネマQ）
/api/go?th=cs-gdcs&d=2026-09-17                       → シネマサンシャイン（グラシネ池袋）
/api/go?th=ae-chofu&d=2026-09-17                       → イオンシネマ（調布）
/api/theaters                                          → 劇場一覧（slug＋日本語名＋chain）
```

| キー | 必須 | 例 | 説明 |
|---|---|---|---|
| `th` | | `urasoe` / `st-cinemaq` / `toho-081` | 劇場スラッグ（省略時 `urasoe`）。接頭辞でチェーンを判別（`st-`/`cs-`/`ae-`/`smt-`/`c109-`/`tj-`/`toho-`、なし＝ユナイテッド） |
| `d` | ✅ | `2026-07-31` | 上映日 |
| `q` | | `スパイダーマン IMAX 字幕` | 作品名検索（空白区切りAND） |
| `f` | | `22072` / `fmq6ie17k` | 作品ID（`q` より優先）。チェーンにより数字とは限らない |
| `t` | | `10:50` | 上映開始時刻。指定すると購入画面へ飛ぶ |
| `json` | | `1` | HTMLでなくJSONで返す |

### 上映回の状態

| status | 意味 | 判定材料 |
|---|---|---|
| `presale` | 会員先行販売中 | `/clubspice/presale.php` リンクあり |
| `onsale` | 通常販売中 | `/all/cc.php` リンクあり |
| `before` | まだ販売前 | `outside_sales_period` アイコン |
| `closed` | 販売対象外（上映済み・締切・満席） | `btn_buy_disable` |

`seat` に空席状況（`○` 空席あり／`△` 残りわずか／`×` 満席／`□` 対象外）が入る。

## デプロイ

Vercel の Hobby プラン（**個人アカウント**）を想定。Hobbyは商用利用不可なので私用限定。

```powershell
npm i -g vercel
vercel login
vercel --prod
```

`api/` 配下が自動的に Serverless Function になる。設定ファイルは不要。

> **Node ランタイムで動かすこと。** Shift_JIS のデコードに `TextDecoder('shift_jis')` を使っており、
> Edge Runtime では UTF-8 しか通らない可能性がある。

## ローカル検証

```powershell
node test.mjs
```

実サイトを相手に、Shift_JISデコード・作品名検索・4状態の判定・リダイレクト生成・劇場一覧を一括確認する。

## 運用メモ（2026-07-28 実測）

- **会員（CLUB-SPICE）の販売開始は上映日3日前の21:00**（実測確認済み）
- **待機列がある。** Queue-it 製で、**ローソン・ユナイテッドシネマグループ全館共通**。
  人気作の初日は21:00直後に1000人超が並ぶ。ページを閉じても順番は維持されるが、
  **順番が来たら5分以内に操作を開始**しないと無効になる
- 販売開始直後はサーバ側/CDNのキャッシュが詰まり、**購入ボタンがしばらく出ないことがある**。
  `cache: 'no-store'` はブラウザキャッシュにしか効かず、CDNキャッシュは回避できない
- **連打はするな。** 相手のサーバに迷惑がかかるし、自分の首も絞める
- `mc` が一度判明すれば、その作品×方式の全日程のURLを自力で組める（`sd` と `st` の差し替えだけ）

### リファラを送ってはいけない

購入画面へのリダイレクトで**リファラを送るとトップページへ飛ばされる**。
`api/go.js` は302の直前に `Referrer-Policy: no-referrer` を付け、
`public/index.html` には `<meta name="referrer" content="no-referrer">` を入れている。
これを外すと動かなくなる。

### ブックマークレット版は使わないこと

初期はブラウザ上で動くブックマークレットを使っていたが、以下の理由で本ツールに移行した。

- **同一オリジンポリシー**により、unitedcinemas.jp のページを開いた状態でしか動かない
- **待機列に入ると別ドメイン（`queue-it.net`）に移るため、使用不能になる**
- iOS Safari以外のモバイルブラウザで実質動作しない

サーバ側で取得する本ツールにはこれらの制約がない。

## 構成

```
cinema-jump/
├── api/
│   ├── go.js         エンドポイント本体（一覧／回一覧／リダイレクト）＋ユナイテッド・シネマの解析
│   └── theaters.js   劇場一覧（1日キャッシュ）
├── lib/
│   ├── chains.js        対応チェーンの登録表（接頭辞・劇場一覧・購入URL）
│   ├── smarttheater.js  SMART THEATER 系の共通処理（状態判定・空席・日時）
│   ├── scheduledata.js  スターシアターズ／シネマサンシャインの共通ローダー
│   ├── aeoncinema.js    イオンシネマ
│   ├── shochiku.js      松竹（MOVIX・ピカデリー・東劇。新旧2方式）
│   ├── cinemas109.js    109シネマズ
│   ├── tjoy.js          T・ジョイ（新宿バルト9 ほか）
│   └── toho.js          TOHOシネマズ（購入はPOST）
├── public/
│   └── index.html    操作UI
├── test.mjs          ローカル検証
├── package.json
└── README.md
```
