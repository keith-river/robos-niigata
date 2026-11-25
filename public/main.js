/* ロボ箱庭ツボすごろく 新潟 — ブラウザ側（UIと通信）
 * サーバが正。ここは状態を表示し、操作を送るだけ。出来事(events)は順番に3D演出へ渡す。
 */
import { World } from './scene.js';

const NG = window.NIIGATA, RL = window.ROLES, TL = window.TOOLS;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nl = (s) => esc(s).replace(/\n/g, '<br>');
const roleOf = (id) => RL.byId(id) || RL.ROLES[0];

const world = new World($('stage'));
const socket = io();
let S = null;                       // 最新の状態
let draft = { round: 0, f: {}, replies: [], msgs: {}, cards: {}, how: {} };
let themeSeen = false, showSide = false, tab = 'now';
const DIMS = { logic: '論理', job: 'ジョブ', disrupt: '破壊力', nudge: 'ナッジ', feasibility: '実行性', empathy: '共感' };
const KIND = { weapon: '⚔️攻め', armor: '🛡️守り', both: '⚔️🛡️両用' };

// ------------------------------------------------------------------ 通信
const queue = []; let busy = false;
socket.on('update', (u) => { queue.push(u); pump(); });
socket.on('toast', (m) => toast(m));
socket.on('markdown', (md) => {
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
  a.download = 'tsubomap-niigata-record.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.add('hidden'), 3500); }

async function pump() {
  if (busy) return; busy = true;
  while (queue.length) {
    const { state, events } = queue.shift();
    world.mine = state.you;
    if (events && events.length) {
      if (events.some((e) => e.t === 'start' || e.t === 'lobby')) { showSide = false; tab = 'now'; themeSeen = false; draft = { round: 0, f: {}, replies: [], msgs: {}, cards: {}, how: {} }; }
      ['lobby', 'result', 'theme', 'hud', 'debate'].forEach((id) => $(id).classList.add('hidden'));
      for (const ev of events) { try { await world.play(ev); } catch (e) { console.error(e); } }
    } else world.sync(state);
    S = state; applyView(); render();
  }
  busy = false;
}
function applyView() {
  const s = S, g = s.gather;
  world.setAssign(s.assign);
  if (s.phase === 'gather' && g) {
    world.setTurn(g.turnId);
    world.setOptions(g.turnId === s.you ? g.options : []);
  } else if (s.phase === 'debate' && s.debate) { world.setTurn(s.debate.writerId); world.setOptions([]); }
  else { world.setTurn(null); world.setOptions([]); }
}

// ------------------------------------------------------------------ 描画
function render() {
  const s = S; if (!s) return;
  const me = s.players.find((p) => p.id === s.you);
  $('badge').textContent = ({
    lobby: `ロビー（${s.players.length}/4）`,
    gather: g_badge(s),
    debate: s.debate ? `討論 ${s.debate.round}/${s.debate.rounds}周め` : '討論',
    over: '討論おわり'
  })[s.phase] || '';
  $('log-list').innerHTML = (s.log || []).slice(-80).map((l) => `<li>${esc(l)}</li>`).join('');
  $('lobby').classList.toggle('hidden', s.phase !== 'lobby');
  $('hud').classList.toggle('hidden', s.phase !== 'gather');
  if (s.phase === 'lobby') renderLobby(s, me);
  if (s.phase === 'gather') renderHud(s);
  const inDebate = s.phase === 'debate' && s.debate;
  const showTheme = inDebate && !themeSeen && s.debate.round === 1 && s.debate.step === 'propose' && s.theme;
  $('theme').classList.toggle('hidden', !showTheme);
  if (showTheme) renderTheme(s);
  const side = (inDebate && !showTheme) || (s.phase === 'over' && showSide);
  $('debate').classList.toggle('hidden', !side);
  if (side) renderDebate(s, me);
  if (s.phase === 'over') renderResult(s);
  $('result').classList.toggle('hidden', !(s.phase === 'over' && !showSide));
}
function g_badge(s) { const g = s.gather; if (!g) return '集合'; const p = s.players.find((x) => x.id === g.turnId); return `集合 ${g.round}/${g.maxRounds}周め${p ? ` ・ ${p.name}の番` : ''}`; }

// ---- ロビー
function renderLobby(s, me) {
  if (document.activeElement !== $('name')) $('name').value = me ? me.name : '';
  const taken = new Set(s.players.filter((p) => p.id !== s.you).map((p) => p.role));
  $('roles').innerHTML = RL.ROLES.map((r) => `<button class="role ${me && me.role === r.id ? 'on' : ''} ${taken.has(r.id) ? 'taken' : ''}" data-r="${r.id}" style="--c:${r.color}">
    <b>${r.icon} ${esc(r.name)}</b><span>強み：${esc(r.skill)}</span><span>役目：${esc(r.duty)}</span></button>`).join('');
  $('roles').querySelectorAll('.role').forEach((b) => { b.onclick = () => socket.emit('setRole', b.dataset.r); });
  $('as-real').classList.toggle('on', s.assignMode !== 'random'); $('as-rand').classList.toggle('on', s.assignMode === 'random');
  $('plist').innerHTML = s.players.map((p) => { const r = roleOf(p.role); return `<span class="chip ${p.id === s.you ? 'me' : ''}" style="--c:${r.color}">${r.icon} ${esc(p.name)}${p.bot ? '（CPU）' : ''}<small class="muted">${esc(r.name)}</small></span>`; }).join('');
  $('start').disabled = s.players.length < 2;
  $('add-bot').disabled = s.players.length >= 4;
  $('del-bot').disabled = !s.players.some((p) => p.bot);
  $('lobby-note').textContent = s.players.length < 2 ? '2体以上で始められます。CPUを追加するか、友だちを招待してください。' : '「ゲーム開始」で、ロボットが半径7以内にランダムに降り立ちます。';
}
$('name').addEventListener('change', () => socket.emit('setName', $('name').value));
$('as-real').onclick = () => socket.emit('setAssign', 'real');
$('as-rand').onclick = () => socket.emit('setAssign', 'random');
$('add-bot').onclick = () => socket.emit('addBot');
$('del-bot').onclick = () => socket.emit('removeBot');
$('start').onclick = () => { socket.emit('setName', $('name').value); socket.emit('startGame'); };
$('btn-log').onclick = () => $('log').classList.toggle('hidden');

// ---- 集合HUD
function renderHud(s) {
  const g = s.gather, c = s.center, mine = g && g.turnId === s.you;
  const turn = s.players.find((p) => p.id === (g && g.turnId));
  $('hud-main').innerHTML = `<div class="hud-head"><b>📍 集まりの石：${esc(NG.NAMES[c])}</b>
    <span class="muted">${g.round}/${g.maxRounds}周め ・ ${turn ? esc(turn.name) + 'の番' : ''}${g.dice ? ` 🎲${g.dice}` : ''}</span>
    <span class="muted small">金の輪＝半径3（ここに4人全員が入れば集合）</span></div>
    <div class="dist">${s.players.map((p) => { const d = NG.dist(c, p.tile); const r = roleOf(p.role); return `<span class="chip ${d <= 3 ? 'ok' : ''}" style="--c:${r.color}">${r.icon} ${esc(p.name)} <small>${NG.NAMES[p.tile]}（${NG.ISSUES[s.assign[p.tile]].k}）距離 ${d.toFixed(1)}</small></span>`; }).join('')}</div>`;
  $('hud-opts').innerHTML = mine && g.options.length
    ? `<span class="small muted" style="align-self:center">あなたの番：光る石をクリック →</span>` + g.options.map((t) => `<button class="opt" data-t="${t}">${esc(NG.NAMES[t])}・${esc(NG.ISSUES[s.assign[t]].k)}（中心まで ${NG.dist(c, t).toFixed(1)}）</button>`).join('')
    : '';
  $('hud-opts').querySelectorAll('.opt').forEach((b) => { b.onclick = () => socket.emit('move', Number(b.dataset.t)); });
}
world.onPick((t) => socket.emit('move', t));
const tip = document.createElement('div'); tip.className = 'toast hidden'; tip.style.cssText = 'background:#1d2433;top:auto;bottom:80px;max-width:min(420px,92vw);font-weight:600;font-size:13px;line-height:1.5'; document.body.appendChild(tip);
world.onHover((t) => {
  if (t == null || !S) { tip.classList.add('hidden'); return; }
  const is = NG.ISSUES[S.assign[t]]; tip.innerHTML = `<b>${esc(NG.NAMES[t])}</b>　${esc(is.k)}<br>${esc(is.d)}`; tip.classList.remove('hidden');
});

// ---- お題カード
function renderTheme(s) {
  const t = s.theme;
  $('theme').innerHTML = `<h2>🧩 今回のお題</h2><div class="theme-title">${esc(t.title)}</div>
    <p class="lead">集まった4人の立ち位置が、新潟県の複合的な課題になりました。</p>
    <div class="theme-items">${t.items.map((i) => { const r = roleOf(i.role); return `<div class="titem" style="--c:${r.color}"><b>${r.icon} ${esc(i.name)}</b>（${esc(r.name)}）<br>📍${esc(i.town)}／${esc(i.issue)}${i.home ? '<br>⭐ 得意な課題（手札+1）' : ''}</div>`; }).join('')}</div>
    ${t.pairs && t.pairs.length ? `<div class="small muted">つながりが強い課題：${t.pairs.map((p) => `${esc(p.a)}×${esc(p.b)}`).join('、')}</div>` : ''}
    <div class="q">${esc(t.question)}</div>
    <p class="small muted">進め方：①ジョブ（顧客が片づけたい用事）を決める → ②アイデアと実行プランを書く → ③鬼審査員の指摘に論理とナッジで答え、他の3人の心に響く説明に磨く。</p>
    <div class="row"><button id="theme-go" class="btn primary">討論をはじめる</button></div>`;
  $('theme-go').onclick = () => { themeSeen = true; render(); };
}

// ---- 討論パネル
const FIELDS = [['title', 'タイトル', '一言で。例：「〇〇する仕組み」', 1], ['job', 'ジョブ（誰の、どんな用事・進歩か）', '例：「〜のとき、〜な人が、〜を片づけたい」', 2], ['idea', 'アイデア（斬新な変革の中身）', '何を、どう変えるか。既存の選択肢との違いも', 3], ['actions', '実行プラン（誰が・いつまでに・何を）', '最初の一歩、担当、期間、数値の目安（仮置きでOK）', 3], ['nudge', 'ナッジの工夫', '選択の設計：初期設定／摩擦を減らす／社会的規範／損失回避／コミットメントなど', 2]];
function renderDebate(s, me) {
  const d = s.debate, over = s.phase === 'over';
  const writer = s.players.find((p) => p.id === d.writerId), mine = !over && d.writerId === s.you && (d.step === 'propose' || d.step === 'revise');
  if (draft.round !== d.round) draft = { round: d.round, f: {}, replies: [], msgs: {}, cards: {}, how: {} };
  const wr = writer ? roleOf(writer.role) : null;
  let h = `<div class="tabs">${[['now', '現在'], ['hist', '経過'], ['theme', 'お題']].map(([k, n]) => `<button class="tab ${tab === k ? 'on' : ''}" data-tab="${k}">${n}</button>`).join('')}${over ? '<button class="tab" id="side-close">閉じる ✕</button>' : ''}</div>`;
  if (tab === 'theme') h += themeBlock(s);
  else if (tab === 'hist') h += histBlock(d);
  else {
    h += `<h3>${over ? '最終案' : d.step === 'judging' ? '🧐 審査中…' : `✍️ ${esc(writer ? writer.name : '')}（${wr ? esc(wr.name) : ''}）の番：${d.step === 'propose' ? '提案' : '改訂'}`}</h3>`;
    h += `<div class="small muted">審査員：${s.judge && s.judge.mode === 'llm' ? `AI（${esc(s.judge.model)}）` : 'ルールベース（キーワード等の有無で見る簡易審査。AIキー未設定）'}</div>`;
    if (d.plan) h += planBlock(d.plan);
    if (d.critique) h += critiqueBlock(d.critique);
    if (!over) {
      if (mine) h += formBlock(s, d, me);
      else h += `<div class="waiting">${d.step === 'judging' ? '鬼審査員が読んでいます…' : `${esc(writer ? writer.name : '')} が書いています。その間、手札と指摘を読んでおこう。`}</div>`;
      h += handBlock(me, mine);
    }
  }
  $('debate').innerHTML = h;
  $('debate').querySelectorAll('.tab[data-tab]').forEach((b) => { b.onclick = () => { tab = b.dataset.tab; render(); }; });
  const sc = $('side-close'); if (sc) sc.onclick = () => { showSide = false; render(); };
  if (mine) bindForm(s, d, me);
}
function themeBlock(s) { const t = s.theme; return t ? `<div class="theme-title" style="font-size:18px">${esc(t.title)}</div><div class="theme-items">${t.items.map((i) => { const r = roleOf(i.role); return `<div class="titem" style="--c:${r.color}"><b>${r.icon} ${esc(i.name)}</b><br>📍${esc(i.town)}／${esc(i.issue)}</div>`; }).join('')}</div><div class="q">${esc(t.question)}</div>` : ''; }
function planBlock(p) { return `<div class="plan"><h4>${esc(p.title || '（無題）')}</h4><dl style="margin:0">${[['job', 'ジョブ'], ['idea', 'アイデア'], ['actions', '実行プラン'], ['nudge', 'ナッジ']].map(([k, n]) => p[k] ? `<dt>${n}</dt><dd>${nl(p[k])}</dd>` : '').join('')}</dl></div>`; }
function critiqueBlock(c) {
  return `<h3>🧐 鬼審査員の指摘 <span class="muted small">${c.mode === 'llm' ? 'AI審査' : 'ルールベース'}</span></h3>
    <div class="total">${c.scores.total}<small> / 100点</small></div>
    <div class="bars">${Object.entries(DIMS).map(([k, n]) => `<div class="bar"><span>${n}</span><i><u style="width:${c.scores[k]}%"></u></i><span>${c.scores[k]}</span></div>`).join('')}</div>
    ${c.summary ? `<p class="small">${esc(c.summary)}</p>` : ''}
    ${(c.strengths || []).map((x) => `<div class="small">👍 ${esc(x)}</div>`).join('')}
    ${c.points.map((p) => `<div class="pt ${esc(p.severity)}"><span class="lens">${esc(p.lens)}</span>${esc(p.text)}<div class="ask">❓ ${esc(p.question)}</div></div>`).join('')}
    ${(c.reactions || []).length ? `<h3>他のステークホルダーの反応</h3>${c.reactions.map((r) => `<div class="react"><span class="mood">${{ yes: '😊', maybe: '🤔', no: '😟' }[r.mood]}</span><div><b>${esc(r.name)}</b>：${esc(r.text)}</div></div>`).join('')}` : ''}`;
}
function histBlock(d) {
  return `<div class="hist">${d.history.map((h) => h.type === 'submit'
    ? `<details><summary>✍️ ${h.round}周め ${esc(h.writerName)}（${esc(roleOf(h.role).name)}）${h.auto ? '・自動代筆' : ''}</summary>${planBlock(h.plan)}${(h.replies || []).map((r, i) => `<div>↩ ${i + 1}. ${esc(r)}</div>`).join('')}${(h.cards || []).map((c) => `<div>🃏 ${esc((TL.byId[c.id] || {}).name || c.id)}：${esc(c.how)}</div>`).join('')}</details>`
    : `<details><summary>🧐 ${h.round}周め 審査：${h.scores.total}点</summary>${critiqueBlock(h)}</details>`).join('')}</div>`;
}
function handBlock(me, selectable) {
  if (!me || !me.hand) return '';
  const spent = me.spent || [];
  return `<h3>🃏 あなたの手札 <span class="muted small">${selectable ? '（最大2枚まで使えます。どう使ったかも書く）' : '（使うと補充されます）'}</span></h3>
    <div class="hand">${me.hand.map((id) => cardHtml(id, selectable, draft.cards[id])).join('')}</div>
    ${spent.length ? `<div class="small muted" style="margin-top:6px">使用済み：${spent.map((id) => esc((TL.byId[id] || {}).name || id)).join('、')}</div>` : ''}`;
}
function cardHtml(id, selectable, on) {
  const t = TL.byId[id]; if (!t) return ''; const f = TL.FAMILY[t.family];
  return `<button class="card ${on ? 'on' : ''}" data-card="${id}" style="--c:${f.color}" ${selectable ? '' : 'tabindex="-1"'}><span class="k">${f.icon} ${esc(f.name)} ・ ${KIND[t.kind] || ''}</span><b>${esc(t.name)}</b>${esc(t.tip)}</button>`;
}
function formBlock(s, d, me) {
  const first = d.step === 'propose', pts = (d.critique && d.critique.points) || [], others = s.players.filter((p) => p.id !== s.you);
  const val = (k) => (draft.f[k] !== undefined ? draft.f[k] : (first ? '' : (d.plan && d.plan[k]) || ''));
  let h = `<h3>${first ? 'あなたの提案を書こう' : '指摘に答えて、案を磨こう'}</h3><div class="form">`;
  if (!first) {
    h += pts.map((p, i) => `<label>指摘${i + 1}：${esc(p.text)}<br><span class="hint">❓ ${esc(p.question)}</span></label><textarea data-reply="${i}" placeholder="論理で答える。データ・仮定・反論への対策を">${esc(draft.replies[i] || '')}</textarea>`).join('');
    h += `<h3>他のステークホルダーへ、心に響く一言（ナッジの工夫）</h3>` + others.map((o) => { const r = roleOf(o.role); return `<label>${r.icon} ${esc(o.name)}（${esc(r.name)}）へ<br><span class="hint">この人が大事にすること：${esc(r.cares.join('・'))} ／ 気がかり：${esc(r.worries.join('・'))}</span></label><textarea data-msg="${o.id}" placeholder="この人が動きたくなる言い方・仕組みで">${esc(draft.msgs[o.id] || '')}</textarea>`; }).join('');
    h += `<h3>案の更新（変えないところは、そのままでOK）</h3>`;
  }
  h += FIELDS.map(([k, n, ph, rows]) => `<label>${n}</label>${k === 'title' ? `<input data-f="${k}" value="${esc(val(k))}" placeholder="${esc(ph)}">` : `<textarea data-f="${k}" rows="${rows}" placeholder="${esc(ph)}">${esc(val(k))}</textarea>`}`).join('');
  const sel = Object.keys(draft.cards).filter((k) => draft.cards[k]);
  if (sel.length) h += `<label>カードの使い方</label>` + sel.map((id) => `<div class="how"><span class="small"><b>${esc((TL.byId[id] || {}).name)}</b></span><textarea data-how="${id}" rows="2" placeholder="このカードを、この案のどこにどう使ったか">${esc(draft.how[id] || '')}</textarea></div>`).join('');
  h += `<div class="row"><button id="send" class="btn primary">${first ? '提案する' : '改訂して提出'}</button></div></div>`;
  return h;
}
function bindForm(s, d, me) {
  const root = $('debate');
  root.querySelectorAll('[data-f]').forEach((e) => e.addEventListener('input', () => { draft.f[e.dataset.f] = e.value; }));
  root.querySelectorAll('[data-reply]').forEach((e) => e.addEventListener('input', () => { draft.replies[Number(e.dataset.reply)] = e.value; }));
  root.querySelectorAll('[data-msg]').forEach((e) => e.addEventListener('input', () => { draft.msgs[e.dataset.msg] = e.value; }));
  root.querySelectorAll('[data-how]').forEach((e) => e.addEventListener('input', () => { draft.how[e.dataset.how] = e.value; }));
  root.querySelectorAll('.card[data-card]').forEach((b) => { b.onclick = () => {
    const id = b.dataset.card; const on = !draft.cards[id];
    if (on && Object.values(draft.cards).filter(Boolean).length >= 2) { toast('1回に使えるカードは2枚までです'); return; }
    draft.cards[id] = on; const sc = root.scrollTop; renderDebate(S, me); root.scrollTop = sc;
  }; });
  $('send').onclick = () => {
    const first = d.step === 'propose';
    const f = Object.fromEntries(FIELDS.map(([k]) => [k, draft.f[k] !== undefined ? draft.f[k] : (first ? '' : (d.plan && d.plan[k]) || '')]));
    const cards = Object.keys(draft.cards).filter((k) => draft.cards[k]).map((id) => ({ id, how: draft.how[id] || '' }));
    const pts = (d.critique && d.critique.points) || [];
    const payload = { ...f, cards, replies: pts.map((_, i) => draft.replies[i] || ''), messages: { ...draft.msgs } };
    socket.emit('submit', payload);
  };
}

// ---- 結果
function renderResult(s) {
  const r = s.result; if (!r) return;
  $('result').innerHTML = `<h2>🏁 討論おわり</h2>
    <div class="total">${r.team}<small> / 100点 ・ <b>${esc(r.rank)}</b> ・ 初案から ${r.growth >= 0 ? '+' : ''}${r.growth}点</small></div>
    <p class="small muted">点数は審査員（${s.judge && s.judge.mode === 'llm' ? 'AI' : 'ルールベースの簡易審査'}）による議論の磨き込みの目安で、案の正しさや効果の予測ではありません。</p>
    <h3>最終案</h3>${planBlock(r.plan)}
    <h3>提案者ごとの得点</h3><div class="rank">${r.ranking.map((p) => { const ro = roleOf(p.role); return `<div style="--c:${ro.color}">${ro.icon} ${esc(p.name)}<small class="muted">${esc(ro.name)}</small><b>${p.score}</b></div>`; }).join('')}</div>
    <div class="row"><button class="btn" id="r-view">経過を見る</button><button class="btn" id="r-md">記録をMarkdownで保存</button><button class="btn primary" id="r-lobby">もう一度あそぶ</button></div>`;
  $('r-view').onclick = () => { showSide = true; tab = 'hist'; render(); };
  $('r-md').onclick = () => socket.emit('exportMarkdown');
  $('r-lobby').onclick = () => { showSide = true; tab = 'now'; socket.emit('backToLobby'); };
}

window.__world = world;   // 確認用
