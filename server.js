const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const { createGame, SPEED } = require('./game');
const critic = require('./critic');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 120 * 1024 });

app.use(express.static('public'));

// ゲームの進行（集合・お題・討論の順番・得点）は game.js が決める。
// ここは「通信」「時間」（CPUの操作・制限時間）「AI審査員の呼び出し」だけを担当する。
const game = createGame();

const MOVE_TIMEOUT_MS = 30000;                                       // 移動先を選ぶ制限時間（超えたらCPUが選ぶ）
const WRITE_TIMEOUT_MS = Number(process.env.WRITE_TIMEOUT_MS) || 420000; // 提案・改訂の制限時間（超えたらCPUが代筆）
const BOT_THINK_MS = [900 * SPEED, 1800 * SPEED];

const humans = new Set();         // 接続中の人間（観戦者を含む）
const names = new Map();          // socket.id → 名前
let version = 0;                  // 状態が進むたびに増やす。古いタイマー・古いAI応答を無効にする印
let timers = [];

const rnd = (a, b) => a + Math.random() * (b - a);
// eslint-disable-next-line no-control-regex
const cleanName = (s) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) : '');

/** 全員に状態を送る。手札は本人にだけ見えるように、人ごとに作って送る。 */
function broadcast(events = []) {
  const judge = { mode: critic.llmEnabled() ? 'llm' : 'rules', model: critic.llmEnabled() ? critic.MODEL : '' };
  for (const id of humans) {
    io.to(id).emit('update', { state: { ...game.snapshot(id), judge, you: id }, events });
  }
}
function publish(res) { broadcast(res.events || []); schedule(res.waitMs || 0); }
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

const allPlayers = () => game.state.order.map((id) => game.state.players[id]);

/** 次の入力待ちを見て、CPUの操作・制限時間・AI審査を仕込む。 */
function schedule(waitMs) {
  clearTimers();
  const v = ++version;
  const aw = game.awaiting();
  if (!aw) return;
  const later = (ms, fn) => timers.push(setTimeout(() => { if (v === version) fn(); }, ms));

  if (aw.type === 'move') {
    const p = game.state.players[aw.id];
    const go = () => publish(game.move(aw.id, game.botMove(aw.id)));
    later(waitMs + (p.bot ? rnd(...BOT_THINK_MS) : MOVE_TIMEOUT_MS), go);
    return;
  }

  if (aw.type === 'write') {
    const p = game.state.players[aw.id];
    const fill = (auto) => {
      const d = game.state.debate;
      const sub = critic.botSubmission({ theme: game.state.theme, writer: p, players: allPlayers(), kind: aw.kind, prev: d.critique, hand: p.hand });
      const r = game.submit(aw.id, { ...sub, auto });
      if (!r.ok) console.warn('代筆に失敗:', r.error);
      publish(r);
    };
    later(waitMs + (p.bot ? rnd(2500 * SPEED, 5000 * SPEED) : WRITE_TIMEOUT_MS), () => fill(!p.bot));
    return;
  }

  if (aw.type === 'judge') {
    const ctx = { theme: game.state.theme, sub: aw.sub, players: allPlayers(), round: game.state.debate.round, prev: game.state.debate.critique };
    // 演出（提案の再生）が終わってから結果を出す。AI応答の待ち時間と並行して進める。
    const started = Date.now();
    critic.judge(ctx).then((j) => {
      if (v !== version) return;
      const wait = Math.max(0, waitMs - (Date.now() - started));
      timers.push(setTimeout(() => { if (v === version) publish(game.applyJudgement(j)); }, wait));
    }).catch((e) => { console.error('審査エラー', e); if (v === version) publish(game.applyJudgement(critic.review(ctx))); });
  }
}

io.on('connection', (socket) => {
  console.log(`接続: ${socket.id}`);
  humans.add(socket.id);
  names.set(socket.id, `ロボ_${socket.id.substring(0, 4)}`);

  // ロビーなら参加者に。ゲーム中は観戦者（次のゲームから参加）。
  if (game.state.phase === 'lobby') game.addPlayer(socket.id, names.get(socket.id));
  broadcast();

  const mine = () => game.state.players[socket.id];
  const guard = (fn) => (...args) => { try { fn(...args); } catch (e) { console.error('handler error', e); } };

  socket.on('setName', guard((raw) => {
    const r = game.setName(socket.id, raw);
    if (r.ok) names.set(socket.id, mine().name);
    else if (!mine()) { const n = cleanName(raw); if (n) names.set(socket.id, n); }
    broadcast();
  }));

  const lobbyOnly = (fn) => guard((...a) => {
    if (game.state.phase !== 'lobby' || !mine()) return;
    const r = fn(...a);
    if (r.ok) publish(r);
  });
  socket.on('setRole', lobbyOnly((role) => game.setRole(socket.id, String(role))));
  socket.on('setAssign', lobbyOnly((mode) => game.setAssign(String(mode))));
  socket.on('addBot', lobbyOnly(() => game.addBot()));
  socket.on('removeBot', lobbyOnly(() => game.removeBot()));
  socket.on('startGame', lobbyOnly(() => game.startGame()));

  socket.on('move', guard((tile) => {
    if (!Number.isInteger(tile)) return;
    const r = game.move(socket.id, tile);
    if (r.ok) publish(r);
  }));
  socket.on('submit', guard((payload) => {
    if (!payload || typeof payload !== 'object') return;
    const r = game.submit(socket.id, payload);
    if (!r.ok) { socket.emit('toast', r.error); return; }
    publish(r);
  }));
  socket.on('exportMarkdown', guard(() => { socket.emit('markdown', game.exportMarkdown()); }));

  socket.on('backToLobby', guard(() => {
    const r = game.backToLobby();
    if (!r.ok) return;
    for (const id of humans) if (!game.state.players[id]) game.addPlayer(id, names.get(id));
    publish(r);
  }));

  socket.on('disconnect', () => {
    console.log(`切断: ${socket.id}`);
    humans.delete(socket.id); names.delete(socket.id);
    if (humans.size === 0) { clearTimers(); version++; game.reset(); return; }
    if (!game.state.players[socket.id]) { broadcast(); return; }
    publish(game.removePlayer(socket.id));
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🤖 ロボ箱庭ツボすごろく Server running at http://localhost:${PORT}`);
  console.log(`   AI審査員: ${critic.llmEnabled() ? 'LLM（' + critic.MODEL + '）' : 'ルールベース（ANTHROPIC_API_KEY が未設定）'}`);
});
