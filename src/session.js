// 複数卓セッション
// セッションは「出来事（イベント）」の並びとして保存し、そこから区切り・卓・ラウンドを組み立てる。
// 端末間の同期（第2段階）でも、このイベントをそのまま送り合う。
import { computeRound, DEFAULT_SETTINGS } from "./logic.js";

export const TABLE_IDS = ["A", "B", "C", "D"];
export const DEFAULT_SESSION_SETTINGS = {
  ...DEFAULT_SETTINGS,
  blockLength: 10, // 区切りの長さ（最後のラウンドが倍マッチ）
};

const zeros = (n) => Array(n).fill(0);
const ALPH = "abcdefghjkmnpqrstuvwxyz23456789";
export function newId(len = 10) {
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => ALPH[x % ALPH.length]).join("");
}

export function makeEvent(k, data, dev) {
  return { id: newId(12), at: Date.now(), dev: dev || null, k, ...data };
}

// ラウンドの入力内容だけを残す（計算結果は組み立て時にやり直す）
export function inputFromRecord(record, settings) {
  const base = {
    type: record.type,
    multiplier: record.multiplier || 1,
    set: {
      declareLine: Number(settings.declareLine ?? 5),
      deckCount: settings.deckCount || 1,
      potEnabled: !!settings.potEnabled,
      potRate: settings.potRate || 1,
      multiplyPotIn: !!settings.multiplyPotIn,
      splitRemainder: settings.splitRemainder || "carry",
    },
    dlb: record.doubleLogBefore || null,
  };
  if (record.type === "success" || record.type === "back") {
    return {
      ...base,
      declarer: record.declarer,
      declarerHand: record.declarerHand,
      targets: record.targets,
      targetHand: record.targetHand,
    };
  }
  if (record.type === "draw") return { ...base, hands: record.hands };
  if (record.type === "manual") return { ...base, manualTransfers: record.transfers };
  return base;
}

// ===== イベントを積み上げてセッションを組み立てる =====
export function foldSession(events) {
  const S = {
    id: null,
    startedAt: null,
    roster: [], // [{id, name}]
    settings: { ...DEFAULT_SESSION_SETTINGS },
    blocks: [],
    ended: false,
    endedAt: null,
  };
  const findTable = (b, t) => {
    const block = S.blocks.find((x) => x.no === b);
    return block ? block.tables.find((x) => x.id === t) : null;
  };
  // 複数の端末から届いた出来事を、どの端末でも同じ順番で積み上げる。
  // 端末の時計が少しずれていても、卓の記録がその区切りより前に並ばないよう、
  // 先にセッションの骨組み（名簿・設定・区切り）を、そのあとで卓の記録を積む。
  const seen = new Set();
  const uniq = (events || []).filter((e) => e && e.id && !seen.has(e.id) && seen.add(e.id));
  const byTime = (a, b) => (a.at || 0) - (b.at || 0) || String(a.id).localeCompare(String(b.id));
  const STRUCT = new Set(["init", "roster", "settings", "block", "end", "reopen"]);
  const ordered = [...uniq.filter((e) => STRUCT.has(e.k)).sort(byTime), ...uniq.filter((e) => !STRUCT.has(e.k)).sort(byTime)];
  for (const e of ordered) {
    switch (e.k) {
      case "init":
        S.id = e.sid;
        S.startedAt = e.at;
        (e.roster || []).forEach((p) => S.roster.push({ id: p.id, name: p.name }));
        S.settings = { ...S.settings, ...(e.settings || {}) };
        break;
      case "roster":
        (e.add || []).forEach((p) => {
          if (!S.roster.some((r) => r.id === p.id)) S.roster.push({ id: p.id, name: p.name });
        });
        break;
      case "settings":
        S.settings = { ...S.settings, ...(e.patch || {}) };
        break;
      case "block": {
        // 同じ番号の区切りが2つの端末から同時に作られたら、あとのほうを使う
        const no = e.no || S.blocks.length + 1;
        const existing = S.blocks.findIndex((x) => x.no === no);
        if (existing >= 0) S.blocks.splice(existing, 1);
        if (no !== S.blocks.length + 1 && existing < 0) break;
        S.blocks.splice(no - 1, 0, {
          no,
          at: e.at,
          tables: (e.tables || []).map((t) => ({
            id: t.id,
            pids: t.pids.slice(),
            set: { ...(t.set || {}) },
            inputs: {},
            doubleLog: {},
          })),
        });
        break;
      }
      case "tset": {
        const tb = findTable(e.b, e.t);
        if (tb) tb.set = { ...tb.set, ...(e.patch || {}) };
        break;
      }
      case "r": {
        const tb = findTable(e.b, e.t);
        if (tb) tb.inputs[e.n] = { in: e.in, at: e.at, id: e.id };
        break;
      }
      case "u": {
        const tb = findTable(e.b, e.t);
        if (tb) delete tb.inputs[e.n];
        break;
      }
      case "dbl": {
        const tb = findTable(e.b, e.t);
        if (tb) tb.doubleLog = e.log || {};
        break;
      }
      case "end":
        S.ended = true;
        S.endedAt = e.at;
        break;
      case "reopen":
        S.ended = false;
        S.endedAt = null;
        break;
      default:
        break;
    }
  }

  // 卓ごとのラウンドを計算し、終わった区切りには残ったポットの返金を付ける
  S.blocks.forEach((block, bi) => {
    const next = S.blocks[bi + 1];
    block.closed = !!next || S.ended;
    block.closedAt = next ? next.at : S.endedAt;
    block.multi = block.tables.length > 1;
    block.tables.forEach((tb) => {
      tb.rounds = deriveTableRounds(tb, S.settings, block);
      tb.status = tableStatus(tb, S.settings, block);
    });
    block.allDone = block.multi && block.tables.every((t) => t.status.done);
  });
  return S;
}

function deriveTableRounds(tb, settings, block) {
  const k = tb.pids.length;
  const ns = Object.keys(tb.inputs)
    .map(Number)
    .sort((a, b) => a - b);
  let pot = 0;
  const rounds = [];
  ns.forEach((n) => {
    const { in: inp, at, id } = tb.inputs[n];
    let rec;
    if (inp.type === "raw") {
      // 1卓の試合から引き継いだラウンド（計算済みの結果をそのまま使う）
      rec = { ...inp.rec };
      pot = rec.potAfter ?? pot;
    } else {
      const set = { ...settings, ...tb.set, ...(inp.set || {}) };
      const r = computeRound(inp, k, pot, set);
      if (r.error) return;
      rec = {
        type: inp.type,
        multiplier: inp.type === "manual" ? 1 : inp.multiplier || 1,
        ...(inp.type === "success" || inp.type === "back"
          ? {
              declarer: inp.declarer,
              declarerHand: Number(inp.declarerHand),
              targets: inp.targets,
              targetHand: Number(inp.targetHand),
            }
          : {}),
        ...(inp.type === "draw" ? { hands: inp.hands.map(Number), declareLine: Number(set.declareLine ?? 5) } : {}),
        transfers: r.transfers,
        potIn: r.potIn,
        potOut: r.potOut,
        deltas: r.deltas,
        potBefore: pot,
        potAfter: r.potAfter,
      };
      pot = r.potAfter;
    }
    rec.id = id;
    rec.at = at;
    rec.n = n;
    rec.doubleLogBefore = inp.dlb || null;
    rec.set = {
      declareLine: (inp.set && inp.set.declareLine) ?? tb.set.declareLine ?? settings.declareLine,
      deckCount: (inp.set && inp.set.deckCount) ?? tb.set.deckCount ?? settings.deckCount,
    };
    rounds.push(rec);
  });
  if (block.closed && pot > 0) {
    const lastAt = rounds.length ? rounds[rounds.length - 1].at : block.at;
    rounds.push(refundRound(rounds, k, pot, Math.max(block.closedAt || 0, lastAt) + 1));
  }
  return rounds;
}

// 区切りの終わりに残ったポットを、最後に誰かが取ってから入れた人へ、入れた分だけ返す
export function refundRound(rounds, k, pot, at) {
  const contrib = zeros(k);
  let lastWinners = [];
  rounds.forEach((r) => {
    const out = r.potOut || [];
    if (out.some((v) => v > 0)) {
      contrib.fill(0);
      lastWinners = out.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
    }
    (r.potIn || []).forEach((v, i) => (contrib[i] += v));
  });
  const refunds = contrib.slice();
  let rest = pot - contrib.reduce((a, b) => a + b, 0); // 山分けで残った端数
  if (rest > 0) {
    const to = lastWinners.length ? lastWinners : [contrib.indexOf(Math.max(...contrib))];
    const each = Math.floor(rest / to.length);
    to.forEach((i) => (refunds[i] += each));
    rest -= each * to.length;
    for (let j = 0; rest > 0; j++, rest--) refunds[to[j % to.length]] += 1;
  }
  return {
    type: "refund",
    multiplier: 1,
    transfers: [],
    potIn: zeros(k),
    potOut: refunds,
    deltas: refunds.slice(),
    potBefore: pot,
    potAfter: 0,
    at,
    n: (rounds.length ? rounds[rounds.length - 1].n : 0) + 1,
  };
}

// 卓の進み具合（複数卓の区切りでは、区切りの最後の倍マッチを終えたら「済」）
function tableStatus(tb, settings, block) {
  const played = tb.rounds.filter((r) => r.type !== "refund").length;
  if (!block.multi) return { played, done: false, doubleRound: null };
  const L = settings.blockLength || 10;
  const e = tb.doubleLog[L];
  const doubleRound = e ? e.targetRound : L;
  const done = !!(e && e.announced && played >= e.targetRound);
  return { played, done, doubleRound, length: L };
}

export function currentBlock(S) {
  return S.blocks[S.blocks.length - 1] || null;
}

// ===== セッション全体を「1つの試合」と同じ形にする（結果画面・統計・CSV・履歴で使う） =====
// filter: { block, table } で範囲を絞れる
export function sessionGame(S, filter = {}) {
  const players = S.roster.map((r) => r.name);
  const n = players.length;
  const pos = {};
  S.roster.forEach((r, i) => (pos[r.id] = i));
  const items = [];
  S.blocks.forEach((b) => {
    if (filter.block && b.no !== filter.block) return;
    b.tables.forEach((t) => {
      if (filter.table && t.id !== filter.table) return;
      t.rounds.forEach((r) => items.push({ b, t, r }));
    });
  });
  items.sort(
    (x, y) =>
      (x.r.at || 0) - (y.r.at || 0) || x.b.no - y.b.no || x.t.id.localeCompare(y.t.id) || (x.r.n || 0) - (y.r.n || 0)
  );
  const potBy = {};
  const sum = () => Object.values(potBy).reduce((a, v) => a + v, 0);
  const rounds = items.map(({ b, t, r }) => {
    const g = (i) => pos[t.pids[i]];
    const arr = (a, fill = 0) => {
      const out = Array(n).fill(fill);
      (a || []).forEach((v, i) => {
        if (g(i) !== undefined) out[g(i)] = v;
      });
      return out;
    };
    const key = `${b.no}:${t.id}`;
    const before = sum();
    potBy[key] = r.potAfter || 0;
    return {
      ...r,
      declarer: r.declarer !== undefined && r.declarer !== null ? g(r.declarer) : r.declarer,
      targets: (r.targets || []).map(g),
      hands: r.hands ? arr(r.hands, "") : undefined,
      deltas: arr(r.deltas),
      potIn: arr(r.potIn),
      potOut: arr(r.potOut),
      transfers: (r.transfers || []).map((x) => ({ ...x, from: g(x.from), to: g(x.to) })),
      potBefore: before,
      potAfter: sum(),
      tablePotBefore: r.potBefore,
      tablePotAfter: r.potAfter,
      block: b.no,
      table: t.id,
      tableRound: r.type === "refund" ? "" : r.n,
      seats: t.pids.map((id) => pos[id]),
    };
  });
  // 途中から加わった人は、最初に卓に入った区切りから線を引く
  const firstBlock = {};
  S.blocks.forEach((b) =>
    b.tables.forEach((t) =>
      t.pids.forEach((id) => {
        if (firstBlock[id] === undefined) firstBlock[id] = b.no;
      })
    )
  );
  const joinedAt = S.roster.map((p) => {
    const fb = firstBlock[p.id];
    if (fb === undefined) return rounds.length;
    if (filter.block || filter.table) return 0;
    return rounds.filter((r) => r.block < fb).length;
  });
  return {
    kind: "session",
    id: S.id,
    players,
    rounds,
    joinedAt,
    settings: { ...S.settings },
    startedAt: S.startedAt ? new Date(S.startedAt).toISOString() : null,
    finishedAt: S.endedAt ? new Date(S.endedAt).toISOString() : null,
    phase: S.ended ? "result" : "play",
    doubleLog: {},
    blocks: S.blocks.length,
    tables: Math.max(0, ...S.blocks.map((b) => b.tables.length)),
  };
}

// 名簿の各人のセッション累計
export function sessionTotals(S) {
  const g = sessionGame(S);
  const totals = zeros(g.players.length);
  g.rounds.forEach((r) => r.deltas.forEach((d, i) => (totals[i] += d)));
  return S.roster.map((p, i) => ({ id: p.id, name: p.name, total: totals[i] }));
}

// ===== 卓の割り振り =====
function shuffle(a) {
  const x = a.slice();
  for (let i = x.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [x[i], x[j]] = [x[j], x[i]];
  }
  return x;
}

// 人数をなるべく均等に分けたときの各卓の人数（多い卓が先）
export function tableSizes(count, tables) {
  const base = Math.floor(count / tables);
  const extra = count % tables;
  return Array.from({ length: tables }, (_, i) => base + (i < extra ? 1 : 0));
}

// people: [{id, total}]、戻り値: 卓ごとの id の配列
export function autoAssign(people, tables, mode) {
  const sizes = tableSizes(people.length, tables);
  const out = sizes.map(() => []);
  if (mode === "mix") {
    // 累計点の順に、折り返しながら配る（各卓に上位と下位が混ざる）
    const sorted = shuffle(people).sort((a, b) => b.total - a.total);
    let ti = 0;
    let dir = 1;
    sorted.forEach((p) => {
      while (out[ti].length >= sizes[ti]) ti = (ti + dir + tables) % tables;
      out[ti].push(p.id);
      const nextTi = ti + dir;
      if (nextTi >= tables || nextTi < 0) dir = -dir;
      else ti = nextTi;
    });
    return out;
  }
  const list = mode === "near" ? shuffle(people).sort((a, b) => b.total - a.total) : shuffle(people);
  let k = 0;
  sizes.forEach((sz, ti) => {
    for (let j = 0; j < sz; j++) out[ti].push(list[k++].id);
  });
  return out;
}

// 1卓の試合をセッションの最初の区切りとして取り込む
export function eventsFromGame(game, dev) {
  const sid = newId(12);
  const roster = game.players.map((name) => ({ id: newId(8), name }));
  const at0 = game.startedAt ? new Date(game.startedAt).getTime() : Date.now();
  const settings = { ...DEFAULT_SESSION_SETTINGS, ...(game.settings || {}) };
  const events = [
    { ...makeEvent("init", { sid, roster, settings }, dev), at: at0 },
    {
      ...makeEvent(
        "block",
        {
          no: 1,
          tables: [
            {
              id: "A",
              pids: roster.map((r) => r.id),
              set: { declareLine: settings.declareLine ?? 5, deckCount: settings.deckCount || 1 },
            },
          ],
        },
        dev
      ),
      at: at0,
    },
  ];
  game.rounds.forEach((r, i) => {
    const t = r.at ? new Date(r.at).getTime() : at0 + i + 1;
    events.push({ ...makeEvent("r", { b: 1, t: "A", n: i + 1, in: { type: "raw", rec: r } }, dev), at: t });
  });
  if (game.doubleLog && Object.keys(game.doubleLog).length) {
    events.push(makeEvent("dbl", { b: 1, t: "A", log: game.doubleLog }, dev));
  }
  return { sid, events };
}
