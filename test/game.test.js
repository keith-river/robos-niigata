'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGame, GATHER_RADIUS, START_RADIUS } = require('../game');
const critic = require('../critic');
const NG = require('../public/data/niigata.js');
const { TOOLS } = require('../public/data/tools.js');
const { ROLES } = require('../public/data/roles.js');

const seeded = (seed = 1) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

/** 4体（人間1＋CPU3）で開始し、集合フェーズをCPUの手で最後まで進める */
function playGather(seed) {
  const g = createGame({ rng: seeded(seed) });
  g.addPlayer('h', 'H'); g.addBot(); g.addBot(); g.addBot();
  assert.equal(g.startGame().ok, true);
  let guard = 0;
  while (g.state.phase === 'gather' && guard++ < 200) {
    const aw = g.awaiting(); assert.equal(aw.type, 'move');
    assert.equal(g.move(aw.id, g.botMove(aw.id)).ok, true);
  }
  return g;
}

test('データ：30市町村・18課題・カード重複なし・役割の定番カードが存在', () => {
  assert.equal(NG.NAMES.length, 30);
  assert.equal(new Set(NG.DEFAULT_ASSIGN).size, NG.ISSUES.length);
  assert.equal(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length);
  for (const r of ROLES) for (const id of r.signature) assert.ok(TOOLS.some((t) => t.id === id), id);
});

test('開始：初期位置は集まりの石から半径7以内、全員別の石、島は除く', () => {
  const g = createGame({ rng: seeded(5) });
  g.addPlayer('h', 'H'); g.addBot(); g.addBot(); g.addBot(); g.startGame();
  const c = g.state.center, tiles = g.state.order.map((id) => g.state.players[id].tile);
  assert.equal(new Set(tiles).size, 4);
  for (const t of tiles) { assert.ok(NG.dist(c, t) <= START_RADIUS + 1e-9); assert.ok(!NG.MUNI[t].isl); }
});

test('集合：何度やっても4周以内に全員が半径3以内に集まる（50シード）', () => {
  for (let s = 1; s <= 50; s++) {
    const g = playGather(s), c = g.state.center;
    assert.equal(g.state.phase, 'debate', `seed ${s}`);
    for (const id of g.state.order) assert.ok(NG.dist(c, g.state.players[id].tile) <= GATHER_RADIUS + 1e-9, `seed ${s}`);
    assert.ok(g.state.theme.items.length === 4);
  }
});

test('移動：自分の番以外・選択肢にない石は拒否される', () => {
  const g = createGame({ rng: seeded(2) });
  g.addPlayer('h', 'H'); g.addBot(); g.startGame();
  const aw = g.awaiting();
  assert.equal(g.move('nobody', 0).ok, false);
  const bad = [...Array(30).keys()].find((t) => !g.state.gather.options.includes(t));
  assert.equal(g.move(aw.id, bad).ok, false);
});

test('討論：提出の検証（短すぎる提案・手札にないカードは通らない）→審査→最終まで進む', () => {
  const g = playGather(11);
  const d = g.state.debate; let guard = 0;
  assert.equal(g.submit(d.writerId, { job: 'x', idea: 'y', actions: 'z' }).ok, false);
  while (g.state.phase === 'debate' && guard++ < 30) {
    const aw = g.awaiting(); const p = g.state.players[aw.id];
    if (aw.type === 'write') {
      const sub = critic.botSubmission({ theme: g.state.theme, writer: p, players: g.state.order.map((i) => g.state.players[i]), kind: aw.kind, prev: g.state.debate.critique, hand: p.hand });
      const r = g.submit(aw.id, { ...sub, cards: [...(sub.cards || []), { id: 'not-a-card', how: 'x' }] });
      assert.equal(r.ok, true, r.error);
    } else {
      const j = critic.review({ theme: g.state.theme, sub: aw.sub, players: g.state.order.map((i) => g.state.players[i]), round: g.state.debate.round, prev: g.state.debate.critique });
      assert.equal(g.applyJudgement(j).ok, true);
    }
  }
  assert.equal(g.state.phase, 'over');
  assert.ok(g.state.result.team >= 0 && g.state.result.team <= 100);
  assert.match(g.exportMarkdown(), /お題/);
});

test('手札は本人にしか見えない', () => {
  const g = playGather(3);
  const a = g.snapshot('h'), b = g.snapshot(g.state.order[1]);
  assert.ok(a.players.find((p) => p.id === 'h').hand);
  assert.equal(b.players.find((p) => p.id === 'h').hand, undefined);
});

test('審査員（ルールベース）：中身のある案は、空疎な案より高く採点される', () => {
  const g = playGather(21), p = g.state.players[g.state.order[0]];
  const base = { theme: g.state.theme, players: g.state.order.map((i) => g.state.players[i]), round: 1, prev: null };
  const mk = (plan) => ({ writerId: p.id, writerName: p.name, role: p.role, round: 1, plan, replies: [], messages: {}, cards: [] });
  const weak = critic.review({ ...base, sub: mk({ title: 'あ', job: 'みんなで頑張る方法を考えたい', idea: 'いい感じにする仕組みを作る', actions: '頑張ってやっていく予定です', nudge: '' }) });
  const strong = critic.review({ ...base, sub: mk({ title: '通院を支える仕組み', job: '高齢の住民が、通院したいという進歩を片づけたい。現状の代替は家族の送迎', idea: 'オンデマンド交通を初期設定で自動登録にする。既存のバスの上乗せではなく予約の手間をなくす', actions: '県と市町村が来年4月までに3地区で実証。利用率30%、年500万円の費用で、担当は市町村職員。リスクは運転手不足', nudge: '初期設定（デフォルト）で登録、手間を減らし、同世代の利用実績を見せる' }) });
  const mean = (j) => Object.values(j.scores).reduce((a, b) => a + b, 0) / Object.values(j.scores).length;
  assert.ok(mean(strong) > mean(weak) + 10, `${mean(strong)} vs ${mean(weak)}`);
  assert.ok(weak.points.length > 0);
});
