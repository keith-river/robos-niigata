'use strict';
/**
 * ロボ箱庭ツボすごろく — ゲームロジック（通信・時間・AIに依存しない純粋なロジック）
 *
 * 流れ
 *  1. ロビー      : 最大4名のステークホルダー（役割カードを選ぶ）。足りなければCPUを追加。
 *  2. 集合(gather): 新潟県30市町村の石畳に、課題が1つずつ置かれている。
 *                   ロボットは「集まりの石」から半径7以内（ただし4.5以上離れた所）にランダムに置かれ、
 *                   サイコロ(1〜3歩)で石畳を歩いて、半径3以内に集まる（最大4周。届かない人は磁力で引き寄せ）。
 *  3. お題(theme) : 集まった4人の立ち位置の課題が、複合課題のお題になる。
 *  4. 討論(debate): 提案→AI審査員の批判→改訂…を繰り返す。手札（ナッジ・Job理論・破壊的イノベーション・MBAの道具）を
 *                   武器・防具として使い、批判に論理で答え、他のステークホルダーに響く説明を磨く。
 *  5. 終了(over)  : チームの最終案と得点。マークダウンで書き出せる。
 *
 * すべての変更メソッドは { ok, events, waitMs } を返す。
 *  events … クライアントが順に再生する出来事（各イベントの ms は演出の長さの目安）
 *  waitMs … events を再生し終えるまでの目安（サーバがCPUの操作やタイムアウトの起点に使う）
 * AI審査は非同期なので、このファイルには入れない。awaiting() が {type:'judge'} を返したら、
 * サーバが審査員(critic.js)を呼び、その結果を applyJudgement() に渡す。
 */

const NIIGATA = require('./public/data/niigata.js');
const { ROLES } = require('./public/data/roles.js');
const { TOOLS, byId: TOOL } = require('./public/data/tools.js');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 4;
const START_RADIUS = 7;          // 初期位置：集まりの石からこの距離以内
const START_MIN = 4.5;           // ただし、これ以上離れた石（旅になるように）
const GATHER_RADIUS = 3;         // 集合の条件：集まりの石からこの距離以内
const GATHER_ROUNDS = 4;         // 最大の周回数
const MIN_ROUNDS_BEFORE_END = 2; // 早く集まっても、少なくともこの周回までは続ける
const DICE_MAX = 3;
const HAND_SIZE = 6;
const MAX_CARDS_PER_SUBMIT = 2;
const FIELD_MAX = 900;
const LOG_LIMIT = 80;
const MIN_DEBATE_ROUNDS = 3;

const SPEED = Number(process.env.SUGOROKU_SPEED) > 0 ? Number(process.env.SUGOROKU_SPEED) : 1;
const BASE_DUR = {
  start: 2600, round: 900, turn: 700, roll: 1500, move: 520, pull: 650, gathered: 2600, theme: 3600,
  debateStart: 1200, proposal: 1400, critique: 1800, final: 5000, lobby: 100, note: 0
};
const DUR = Object.fromEntries(Object.entries(BASE_DUR).map(([k, v]) => [k, Math.round(v * SPEED)]));

const BOT_NAMES = ['ロボ太', 'メカ吉', 'ピコ', 'ガチャ丸', 'ネジ子', 'ボルト', 'ギア美', 'サビ丸'];

// eslint-disable-next-line no-control-regex
const clean = (s, n = FIELD_MAX) => (typeof s === 'string' ? s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f<>]/g, '').trim().slice(0, n) : '');

function createGame({ rng = Math.random } = {}) {
  const state = freshState();
  let out = [];

  function freshState() {
    return {
      phase: 'lobby',          // lobby | gather | debate | over
      players: {},             // id → { id, name, color, role, bot, left, tile, hand, score, home }
      order: [],
      assign: [...NIIGATA.DEFAULT_ASSIGN],   // 石(0..29) → 課題の番号
      assignMode: 'real',      // real=初期設定 / random=ランダム
      center: null,
      gather: null,            // { round, queue, turnId, dice, options }
      theme: null,
      debate: null,
      result: null,
      log: []
    };
  }

  // ---------- 小物 ----------
  const P = (id) => state.players[id];
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];
  const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const players = () => state.order.map((id) => state.players[id]);
  const issueAt = (tile) => NIIGATA.ISSUES[state.assign[tile]];
  const roleOf = (p) => ROLES.find((r) => r.id === p.role);

  function push(t, data = {}, text, ms) {
    const ev = { t, ms: ms ?? DUR[t] ?? 0, ...data };
    if (text) { ev.log = text; state.log.push(text); if (state.log.length > LOG_LIMIT) state.log.shift(); }
    out.push(ev);
    return ev;
  }
  function run(fn) {
    out = [];
    const res = fn();
    const events = out; out = [];
    const waitMs = events.reduce((s, e) => s + (e.ms || 0), 0);
    if (res && res.error) return { ok: false, error: res.error, events: [], waitMs: 0 };
    return { ok: true, events, waitMs, ...(res && res.extra ? res.extra : {}) };
  }
  const fail = (error) => ({ error });

  const usedColors = () => new Set(Object.values(state.players).map((p) => p.color));
  const freeRoles = () => ROLES.filter((r) => !players().some((p) => p.role === r.id));

  // ---------- ロビー ----------
  function addPlayer(id, name, { bot = false } = {}) {
    return run(() => {
      if (state.phase !== 'lobby') return fail('ゲーム中は参加できません');
      if (state.players[id]) return fail('参加済みです');
      if (state.order.length >= MAX_PLAYERS) return fail('満員です（最大4名）');
      const used = usedColors();
      let color = 0; while (used.has(color)) color++;
      const role = (freeRoles()[0] || ROLES[0]).id;
      state.players[id] = { id, name, color, role, bot, left: false, tile: null, hand: [], spent: [], score: 0, home: false };
      state.order.push(id);
    });
  }
  function addBot() {
    const used = new Set(players().map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `CPU${state.order.length + 1}`;
    const id = `bot-${Math.floor(rng() * 1e9).toString(36)}-${state.order.length}`;
    const res = addPlayer(id, name, { bot: true });
    return res.ok ? { ...res, id } : res;
  }
  function removeBot() {
    return run(() => {
      if (state.phase !== 'lobby') return fail('ロビーでのみ操作できます');
      const id = [...state.order].reverse().find((i) => state.players[i].bot);
      if (!id) return fail('CPUがいません');
      state.order.splice(state.order.indexOf(id), 1); delete state.players[id];
    });
  }
  function setName(id, raw) {
    return run(() => {
      const p = P(id); if (!p || typeof raw !== 'string') return fail('不正な操作です');
      const name = clean(raw, 12);
      if (!name || name === p.name) return fail('変更なし');
      p.name = name;
    });
  }
  function setRole(id, roleId) {
    return run(() => {
      const p = P(id);
      if (!p || state.phase !== 'lobby') return fail('ロビーでのみ変更できます');
      if (!ROLES.some((r) => r.id === roleId)) return fail('不明な役割です');
      if (players().some((o) => o.id !== id && o.role === roleId)) return fail('その役割は他の人が選んでいます');
      p.role = roleId;
    });
  }
  /** 石畳の課題の割り当てを変える。mode: 'real'=初期設定 / 'random'=ランダム（毎回別の並び） */
  function setAssign(mode) {
    return run(() => {
      if (state.phase !== 'lobby') return fail('ロビーでのみ変更できます');
      if (mode === 'real') { state.assign = [...NIIGATA.DEFAULT_ASSIGN]; state.assignMode = 'real'; return; }
      if (mode === 'random') {
        // 18課題が必ず1回以上出るように配り、残り12枚は無作為
        const base = shuffle([...Array(NIIGATA.ISSUES.length).keys()]);
        const extra = Array.from({ length: NIIGATA.N - base.length }, () => Math.floor(rng() * NIIGATA.ISSUES.length));
        state.assign = shuffle([...base, ...extra]); state.assignMode = 'random'; return;
      }
      return fail('不明な割り当てです');
    });
  }
  function removePlayer(id) {
    return run(() => {
      const p = P(id); if (!p) return;
      if (state.phase === 'lobby') { state.order.splice(state.order.indexOf(id), 1); delete state.players[id]; return; }
      p.bot = true; p.left = true;
      push('note', {}, `📡 ${p.name} の接続が切れたので、CPUが引き継ぎました。`);
    });
  }

  // ---------- ゲーム開始：集まりの石と初期位置 ----------
  function candidateCenters(n) {
    return NIIGATA.MUNI.filter((m) => !m.isl).map((m) => m.i).filter((c) => {
      const b3 = NIIGATA.ball(c, GATHER_RADIUS).length;
      const ring = NIIGATA.ball(c, START_RADIUS).filter((j) => !NIIGATA.MUNI[j].isl && NIIGATA.dist(c, j) >= START_MIN);
      return b3 >= Math.max(6, n + 2) && ring.length >= n + 1;
    });
  }
  function startGame() {
    return run(() => {
      if (state.phase !== 'lobby') return fail('すでに始まっています');
      if (state.order.length < MIN_PLAYERS) return fail(`${MIN_PLAYERS}人以上で始められます（CPUを追加できます）`);
      const n = state.order.length;
      const center = pick(candidateCenters(n));
      const ring = shuffle(NIIGATA.ball(center, START_RADIUS).filter((j) => !NIIGATA.MUNI[j].isl && NIIGATA.dist(center, j) >= START_MIN));
      state.center = center;
      state.order.forEach((id, i) => { const p = P(id); p.tile = ring[i]; p.score = 0; p.hand = []; p.spent = []; p.home = false; });
      state.phase = 'gather';
      state.theme = null; state.debate = null; state.result = null;
      state.gather = { round: 1, queue: [...state.order], turnId: null, dice: null, options: [] };
      push('start', {
        center, startRadius: START_RADIUS, gatherRadius: GATHER_RADIUS, assign: state.assign, maxRounds: GATHER_ROUNDS,
        players: players().map(pub)
      }, `🎮 新潟県の石畳に、${n}体のロボットが降り立ちました。集まりの石（${NIIGATA.NAMES[center]}）を目指して、半径${GATHER_RADIUS}以内に集まろう。`);
      beginTurn();
    });
  }
  const pub = (p) => ({ id: p.id, name: p.name, color: p.color, role: p.role, tile: p.tile, bot: p.bot, score: p.score });

  // ---------- 集合フェーズ ----------
  function occupied(exceptId) { return new Set(players().filter((p) => p.id !== exceptId).map((p) => p.tile)); }
  function optionsFor(id, dice) {
    const p = P(id), c = state.center, occ = occupied(id);
    const cur = NIIGATA.dist(c, p.tile);
    const reach = NIIGATA.reach(p.tile, dice);
    const ok = [];
    for (const [t] of reach) {
      if (t === p.tile || occ.has(t)) continue;
      const d = NIIGATA.dist(c, t);
      if (cur > GATHER_RADIUS) { if (d <= GATHER_RADIUS || d < cur - 0.01) ok.push(t); }   // 遠いうちは、集まりの石に近づく石だけ
      else if (d <= GATHER_RADIUS) ok.push(t);                                              // 近づいたら、輪の中で動く
    }
    return ok;
  }
  function beginTurn() {
    const g = state.gather;
    const id = g.queue[0];
    g.turnId = id;
    const dice = 1 + Math.floor(rng() * DICE_MAX);
    const options = optionsFor(id, dice);
    g.dice = dice; g.options = options;
    const p = P(id);
    push('turn', { id, round: g.round }, null);
    push('roll', { id, dice, options }, `🎲 ${p.name} は ${dice} が出た。`);
    if (!options.length) { push('note', {}, `${p.name} は動ける石がなく、その場で待機。`); finishTurn(id); }
  }
  function finishTurn(id) {
    const g = state.gather;
    g.queue.shift();
    if (g.queue.length) { beginTurn(); return; }
    // 1周おわり
    const outside = players().filter((p) => NIIGATA.dist(state.center, p.tile) > GATHER_RADIUS);
    const done = !outside.length && g.round >= MIN_ROUNDS_BEFORE_END;
    if (done || g.round >= GATHER_ROUNDS) { pullStragglers(); gathered(); return; }
    g.round += 1; g.queue = [...state.order];
    push('round', { n: g.round }, `— ${g.round}周め —`);
    beginTurn();
  }
  function move(id, tile) {
    return run(() => {
      const g = state.gather;
      if (state.phase !== 'gather' || !g || g.turnId !== id) return fail('あなたの番ではありません');
      if (!g.options.includes(tile)) return fail('その石には進めません');
      const p = P(id);
      const path = NIIGATA.path(p.tile, tile);
      p.tile = tile;
      push('move', { id, path, to: tile, ferry: path.some((t, i) => NIIGATA.isFerry(i ? path[i - 1] : p.tile, t)) }, null, DUR.move * Math.max(1, path.length));
      push('note', {}, `👣 ${p.name} は ${NIIGATA.NAMES[tile]}（${issueAt(tile).k}）へ。`);
      finishTurn(id);
    });
  }
  /** 半径3の外に残った人を、集まりの石に引き寄せる（最大周回に達したとき） */
  function pullStragglers() {
    const c = state.center;
    for (const p of players()) {
      if (NIIGATA.dist(c, p.tile) <= GATHER_RADIUS) continue;
      const occ = occupied(p.id);
      const cand = NIIGATA.ball(c, GATHER_RADIUS).filter((t) => !occ.has(t));
      cand.sort((a, b) => NIIGATA.path(p.tile, a).length - NIIGATA.path(p.tile, b).length);
      const to = cand[0]; if (to == null) continue;
      const path = NIIGATA.path(p.tile, to);
      p.tile = to;
      push('pull', { id: p.id, path, to }, `🧲 ${p.name} は磁力で ${NIIGATA.NAMES[to]} に引き寄せられた。`, DUR.pull * Math.max(1, path.length));
    }
  }
  function gathered() {
    const tiles = players().map((p) => p.tile);
    push('gathered', { tiles, center: state.center, radius: GATHER_RADIUS }, `📍 ${players().length}体が半径${GATHER_RADIUS}以内に集まりました。`);
    buildTheme();
    beginDebate();
  }

  // ---------- お題 ----------
  function buildTheme() {
    const items = players().map((p) => {
      const role = roleOf(p), issue = issueAt(p.tile);
      p.home = role.expert.includes(state.assign[p.tile]);
      return { id: p.id, name: p.name, role: p.role, tile: p.tile, town: NIIGATA.NAMES[p.tile], issueIdx: state.assign[p.tile], issue: issue.k, home: p.home };
    });
    const pairs = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      pairs.push({ a: items[i].issue, b: items[j].issue, w: NIIGATA.affinity(items[i].issueIdx, items[j].issueIdx) });
    }
    pairs.sort((x, y) => y.w - x.w);
    const issueKeys = [...new Set(items.map((i) => i.issue))];
    state.theme = {
      title: issueKeys.join(' × '),
      items,
      pairs: pairs.slice(0, 3),
      question: `「${issueKeys.join('」「')}」が重なるこの地域で、立場の違う${items.length}人が、誰も取り残さずに前へ進む変革を、どう設計するか？`
    };
    push('theme', { theme: state.theme }, `🧩 お題：${state.theme.title}`);
  }

  // ---------- 討論フェーズ ----------
  function deal() {
    const deck = shuffle(TOOLS.map((t) => t.id));
    for (const p of players()) {
      const role = roleOf(p);
      const hand = [...role.signature];
      const n = HAND_SIZE + (p.home ? 1 : 0);
      for (const id of deck) { if (hand.length >= n) break; if (!hand.includes(id) && !players().some((o) => o !== p && o.hand.includes(id))) hand.push(id); }
      p.hand = hand; p.spent = [];
    }
  }
  function debateRounds() { return Math.max(MIN_DEBATE_ROUNDS, state.order.length); }
  function beginDebate() {
    state.phase = 'debate';
    deal();
    state.debate = { round: 1, rounds: debateRounds(), writerId: state.order[0], step: 'propose', plan: null, critique: null, history: [], pendingJudge: null, scores: [] };
    push('debateStart', { writerId: state.order[0], rounds: state.debate.rounds }, `🗣️ 討論スタート。最初の提案者は ${P(state.order[0]).name}。`);
  }
  const writerFor = (round) => state.order[(round - 1) % state.order.length];

  function validateCards(p, cards) {
    if (!Array.isArray(cards)) return [];
    const out2 = [];
    for (const c of cards.slice(0, MAX_CARDS_PER_SUBMIT)) {
      const id = c && c.id;
      if (!TOOL[id] || !p.hand.includes(id) || p.spent.includes(id) || out2.some((x) => x.id === id)) continue;
      out2.push({ id, how: clean(c.how, 300) });
    }
    return out2;
  }
  function spend(p, cards) {
    for (const c of cards) { p.spent.push(c.id); p.hand = p.hand.filter((x) => x !== c.id); }
  }
  /** 手札の補充（毎ラウンド、使った枚数ぶん新しい道具を引く） */
  function refill(p, n) {
    const taken = new Set([...players().flatMap((o) => o.hand), ...players().flatMap((o) => o.spent)]);
    const pool = shuffle(TOOLS.map((t) => t.id).filter((id) => !taken.has(id)));
    for (let i = 0; i < n && pool.length; i++) p.hand.push(pool.pop());
  }

  /** 提案（1回め）または改訂（2回め以降）の提出 */
  function submit(id, raw) {
    return run(() => {
      const d = state.debate;
      if (state.phase !== 'debate' || !d || d.step === 'judging' || d.writerId !== id) return fail('あなたの番ではありません');
      const p = P(id), first = d.step === 'propose';
      const plan = {
        title: clean(raw.title, 60), job: clean(raw.job), idea: clean(raw.idea), actions: clean(raw.actions), nudge: clean(raw.nudge)
      };
      if (first && (plan.job.length < 10 || plan.idea.length < 10 || plan.actions.length < 10)) return fail('「ジョブ」「アイデア」「実行プラン」を、それぞれ10文字以上で書いてください');
      let replies = [];
      let messages = {};
      if (!first) {
        const pts = (d.critique && d.critique.points) || [];
        replies = pts.map((_, i) => clean((raw.replies || [])[i], 500));
        if (replies.some((r) => r.length < 5)) return fail('すべての指摘に、答えを書いてください（5文字以上）');
        for (const o of players()) if (o.id !== id) messages[o.id] = clean((raw.messages || {})[o.id], 300);
        if (Object.values(messages).some((m) => m.length < 5)) return fail('他のステークホルダーへの一言を、全員に書いてください（5文字以上）');
        // 空欄は前の案を引き継ぐ
        for (const k of ['title', 'job', 'idea', 'actions', 'nudge']) if (!plan[k]) plan[k] = d.plan[k] || '';
      }
      const cards = validateCards(p, raw.cards);
      spend(p, cards);
      const sub = { round: d.round, writerId: id, writerName: p.name, role: p.role, plan, replies, messages, cards, auto: !!raw.auto };
      d.plan = plan; d.history.push({ type: 'submit', ...sub });
      d.step = 'judging';
      d.pendingJudge = sub;
      push('proposal', { sub }, `✍️ ${p.name}（${roleOf(p).name}）が${first ? '提案' : '改訂案'}を出しました。`);
    });
  }

  /** AI審査員の結果を受け取って、次へ進める */
  function applyJudgement(judgement) {
    return run(() => {
      const d = state.debate;
      if (state.phase !== 'debate' || !d || d.step !== 'judging') return fail('審査待ちではありません');
      const sub = d.pendingJudge, w = P(sub.writerId);
      const j = sanitizeJudgement(judgement);
      d.critique = j; d.pendingJudge = null;
      d.history.push({ type: 'critique', round: d.round, ...j });
      d.scores.push({ round: d.round, writerId: w.id, total: j.scores.total });
      w.score += j.scores.total;
      push('critique', { round: d.round, critique: j, writerId: w.id }, `🧐 審査員の指摘（${j.mode === 'llm' ? 'AI' : 'ルールベース'}）：総合 ${j.scores.total} 点`);
      // 使った道具の補充
      refill(w, sub.cards.length + 1);
      if (d.round >= d.rounds) { finish(); return; }
      d.round += 1; d.writerId = writerFor(d.round); d.step = 'revise';
      push('note', {}, `次の改訂者：${P(d.writerId).name}`);
    });
  }
  function sanitizeJudgement(j) {
    const n = (v) => Math.max(0, Math.min(100, Math.round(Number(v) || 0)));
    const sc = (j && j.scores) || {};
    const dims = ['logic', 'job', 'disrupt', 'nudge', 'feasibility', 'empathy'];
    const scores = Object.fromEntries(dims.map((k) => [k, n(sc[k])]));
    scores.total = Math.round(dims.reduce((s, k) => s + scores[k], 0) / dims.length);
    const points = (Array.isArray(j && j.points) ? j.points : []).slice(0, 5).map((x) => ({
      lens: clean(x && x.lens, 30) || '論理', severity: ['high', 'mid', 'low'].includes(x && x.severity) ? x.severity : 'mid',
      text: clean(x && x.text, 400), question: clean(x && x.question, 300)
    })).filter((x) => x.text);
    const reactions = (Array.isArray(j && j.reactions) ? j.reactions : []).slice(0, 4).map((x) => ({
      id: clean(x && x.id, 60), name: clean(x && x.name, 20), mood: ['yes', 'maybe', 'no'].includes(x && x.mood) ? x.mood : 'maybe', text: clean(x && x.text, 200)
    }));
    return {
      mode: j && j.mode === 'llm' ? 'llm' : 'rules', model: clean(j && j.model, 40), scores, points, reactions,
      strengths: (Array.isArray(j && j.strengths) ? j.strengths : []).slice(0, 3).map((x) => clean(x, 200)).filter(Boolean),
      summary: clean(j && j.summary, 500), used: Array.isArray(j && j.used) ? j.used.slice(0, 6).map((x) => ({ id: clean(x && x.id, 40), ok: !!(x && x.ok), note: clean(x && x.note, 200) })) : []
    };
  }

  function rankName(total) {
    if (total >= 85) return '越後の大軍師';
    if (total >= 72) return '地域変革のツボ師';
    if (total >= 58) return '町づくりの名参謀';
    if (total >= 42) return '見習いファシリテーター';
    return '駆け出しロボ';
  }
  function finish() {
    const d = state.debate;
    state.phase = 'over'; d.step = 'done';
    const last = d.scores[d.scores.length - 1];
    const first = d.scores[0];
    const ranking = players().map((p) => ({ id: p.id, name: p.name, role: p.role, score: p.score })).sort((a, b) => b.score - a.score);
    state.result = {
      team: last ? last.total : 0, first: first ? first.total : 0, rank: rankName(last ? last.total : 0),
      growth: last && first ? last.total - first.total : 0, ranking, plan: d.plan, theme: state.theme
    };
    push('final', { result: state.result }, `🏁 討論おわり。最終案の総合は ${state.result.team} 点（${state.result.rank}）。`);
  }

  /** 全員いなくなったときの完全リセット */
  function reset() { Object.assign(state, freshState()); out = []; }

  function backToLobby() {
    return run(() => {
      if (state.phase === 'lobby') return fail('すでにロビーです');
      const keep = state.order.filter((id) => !state.players[id].left);
      for (const id of Object.keys(state.players)) if (!keep.includes(id)) delete state.players[id];
      state.order = keep;
      keep.forEach((id) => { const p = state.players[id]; Object.assign(p, { tile: null, hand: [], spent: [], score: 0, home: false }); });
      Object.assign(state, { phase: 'lobby', center: null, gather: null, theme: null, debate: null, result: null });
      push('lobby', {});
    });
  }

  // ---------- 待ち（サーバが見る） ----------
  function awaiting() {
    if (state.phase === 'gather' && state.gather && state.gather.turnId && state.gather.options.length) {
      return { type: 'move', id: state.gather.turnId };
    }
    if (state.phase === 'debate' && state.debate) {
      const d = state.debate;
      if (d.step === 'judging') return { type: 'judge', sub: d.pendingJudge };
      if (d.step === 'propose' || d.step === 'revise') return { type: 'write', id: d.writerId, kind: d.step };
    }
    return null;
  }

  /** CPUの移動：集まりの石に近く、得意な課題の石を好む */
  function botMove(id) {
    const g = state.gather, p = P(id), role = roleOf(p);
    const score = (t) => -NIIGATA.dist(state.center, t) + (role.expert.includes(state.assign[t]) ? 0.9 : 0) + rng() * 0.6;
    return [...g.options].sort((a, b) => score(b) - score(a))[0];
  }

  // ---------- 状態の公開 ----------
  function snapshot(forId) {
    const d = state.debate;
    return {
      phase: state.phase,
      assign: state.assign, assignMode: state.assignMode,
      center: state.center,
      order: [...state.order],
      players: players().map((p) => ({
        ...pub(p), home: p.home, handCount: p.hand.length,
        ...(forId === p.id ? { hand: [...p.hand], spent: [...p.spent] } : {})
      })),
      gather: state.gather ? { round: state.gather.round, maxRounds: GATHER_ROUNDS, turnId: state.gather.turnId, dice: state.gather.dice, options: state.gather.options } : null,
      theme: state.theme,
      debate: d ? { round: d.round, rounds: d.rounds, writerId: d.writerId, step: d.step, plan: d.plan, critique: d.critique, history: d.history } : null,
      result: state.result,
      log: state.log
    };
  }

  /** 結果を、そのまま共有・保存できるマークダウンにする */
  function exportMarkdown() {
    const t = state.theme, d = state.debate, r = state.result;
    if (!t || !d || !d.plan) return '';
    const L = [];
    L.push(`# 複合課題の変革プラン：${t.title}`, '');
    L.push('> ロボ箱庭ツボすごろくで作った思考実験の記録です。数値・効果は予測ではなく、議論のための仮置きです。', '');
    L.push('## お題（集まった立ち位置）', '');
    t.items.forEach((i) => { const role = ROLES.find((x) => x.id === i.role); L.push(`- **${i.name}**（${role ? role.name : ''}）… ${i.town}／${i.issue}`); });
    L.push('', `**問い**: ${t.question}`, '', '## 最終案', '');
    L.push(`### ${d.plan.title || '（無題）'}`, '', `**ジョブ（誰が何を前に進めたいか）**\n\n${d.plan.job}`, '', `**アイデア**\n\n${d.plan.idea}`, '', `**実行プラン**\n\n${d.plan.actions}`, '');
    if (d.plan.nudge) L.push(`**ナッジ設計**\n\n${d.plan.nudge}`, '');
    if (r) L.push('## 結果', '', `- 最終案の総合: ${r.team}点（${r.rank}）`, `- 初案からの伸び: ${r.growth >= 0 ? '+' : ''}${r.growth}点`, '');
    L.push('## 議論の経過', '');
    d.history.forEach((h) => {
      if (h.type === 'submit') L.push(`### ラウンド${h.round}：${h.writerName}`, '', h.plan.idea ? `案: ${h.plan.idea}` : '', h.cards.length ? `使った道具: ${h.cards.map((c) => (TOOL[c.id] ? TOOL[c.id].name : c.id)).join('、')}` : '', '');
      else if (h.type === 'critique') {
        L.push(`**審査員の指摘（${h.mode === 'llm' ? 'AI' : 'ルールベース'}・総合${h.scores.total}点）**`, '');
        h.points.forEach((p, i) => L.push(`${i + 1}. [${p.lens}] ${p.text}${p.question ? ` — ${p.question}` : ''}`));
        L.push('');
      }
    });
    return L.join('\n');
  }

  return {
    state, snapshot, awaiting, exportMarkdown,
    addPlayer, addBot, removeBot, setName, setRole, setAssign, removePlayer, startGame, move, botMove,
    submit, applyJudgement, backToLobby, reset, issueAt, roleOf,
    consts: { MIN_PLAYERS, MAX_PLAYERS, START_RADIUS, START_MIN, GATHER_RADIUS, GATHER_ROUNDS, DICE_MAX, HAND_SIZE, MAX_CARDS_PER_SUBMIT }
  };
}

module.exports = { createGame, SPEED, DUR, MIN_PLAYERS, MAX_PLAYERS, GATHER_RADIUS, START_RADIUS };
