// ヤニブ得点計算のロジック（UIから独立した純粋関数）

export const DEFAULT_SETTINGS = {
  potEnabled: false, // 流局ポット
  potRate: 1, // ポットへの支払い倍率
  multiplyPotIn: false, // 倍マッチ中の流局で、ポットへの支払いにも倍率を掛ける
  splitRemainder: "carry", // ポット山分けの端数: carry=ポットに残す / distribute=1点ずつ配る
  doublePeriod: 10, // 倍マッチ周期（0でオフ）
  declareLine: 5, // 宣言ライン（表示用）
  deckCount: 1, // デッキ数（表示用）
};

export const ROUND_TYPE_LABEL = {
  success: "ヤニブ成功",
  back: "ヤニブ返し",
  draw: "流局",
  manual: "手入力",
};

const zeros = (n) => Array(n).fill(0);

// 1ラウンドの点数移動を計算する
// input: { type, multiplier, declarer, declarerHand, targets, targetHand, hands, manualTransfers }
// 返り値: { transfers, potIn, potOut, deltas, potAfter, error }
export function computeRound(input, playerCount, potBefore, settings) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  const mult = Number(input.multiplier) || 1;
  const transfers = [];
  const potIn = zeros(playerCount);
  const potOut = zeros(playerCount);
  let potAfter = potBefore;
  const fail = (error) => ({ error });

  if (input.type === "success" || input.type === "back") {
    const d = input.declarer;
    const targets = input.targets || [];
    const dh = Number(input.declarerHand);
    const th = Number(input.targetHand);
    if (d === null || d === undefined) return fail("宣言者を選んでください");
    if (input.declarerHand === "" || Number.isNaN(dh)) return fail("宣言者の手札合計を入力してください");
    if (targets.length === 0)
      return fail(input.type === "success" ? "最高点の人を選んでください" : "最低点の人を選んでください");
    if (targets.includes(d)) return fail("宣言者は選べません");
    if (input.targetHand === "" || Number.isNaN(th)) return fail("相手の手札合計を入力してください");

    if (input.type === "success") {
      if (th < dh) return fail("成功なのに最高点が宣言者より低くなっています");
      const diff = th - dh;
      const each = Math.ceil(diff / targets.length) * mult; // 折半は宣言者有利に切り上げ
      if (each > 0) targets.forEach((t) => transfers.push({ from: t, to: d, points: each }));
      if (s.potEnabled && potBefore > 0) {
        potOut[d] = potBefore; // ポットは出し合った点の合計なので倍率は掛けない
        potAfter = 0;
      }
    } else {
      if (th >= dh) return fail("返しなのに最低点が宣言者以上になっています");
      const each = (dh - th) * 20 * mult; // 最低点の全員にそれぞれ支払う
      targets.forEach((t) => transfers.push({ from: d, to: t, points: each }));
      if (s.potEnabled && potBefore > 0) {
        const k = targets.length;
        const base = Math.floor(potBefore / k);
        let rem = potBefore - base * k;
        targets.forEach((t) => {
          let share = base;
          if (s.splitRemainder === "distribute" && rem > 0) {
            share += 1;
            rem -= 1;
          }
          potOut[t] = share;
        });
        potAfter = s.splitRemainder === "distribute" ? 0 : rem;
      }
    }
  } else if (input.type === "draw") {
    const hands = input.hands || [];
    if (hands.length !== playerCount || hands.some((h) => h === "" || Number.isNaN(Number(h))))
      return fail("全員の手札合計を入力してください");
    // 各自がポットに入れるのは「手札合計−宣言ライン」（マイナスなら0）
    const line = Number(s.declareLine ?? 5);
    const factor = s.potRate * (mult > 1 && s.multiplyPotIn ? mult : 1);
    hands.forEach((h, i) => {
      potIn[i] = Math.max(0, Number(h) - line) * factor;
    });
    potAfter = potBefore + potIn.reduce((a, b) => a + b, 0);
  } else if (input.type === "manual") {
    (input.manualTransfers || []).forEach((t) => {
      const from = Number(t.from);
      const to = Number(t.to);
      const points = Number(t.points);
      if (!Number.isNaN(points) && points !== 0 && from !== to) transfers.push({ from, to, points });
    });
    if (transfers.length === 0) return fail("点の移動を入力してください");
  } else {
    return fail("結果の種類を選んでください");
  }

  const deltas = zeros(playerCount);
  transfers.forEach((t) => {
    deltas[t.from] -= t.points;
    deltas[t.to] += t.points;
  });
  for (let i = 0; i < playerCount; i++) deltas[i] += potOut[i] - potIn[i];
  return { transfers, potIn, potOut, deltas, potAfter, error: null };
}

// 旧形式（transferの配列）のラウンドを新形式に変換
export function normalizeRound(round, playerCount) {
  if (Array.isArray(round)) {
    const r = computeRound({ type: "manual", manualTransfers: round }, playerCount, 0, {});
    return {
      type: "manual",
      multiplier: 1,
      transfers: r.error ? [] : r.transfers,
      potIn: zeros(playerCount),
      potOut: zeros(playerCount),
      deltas: r.error ? zeros(playerCount) : r.deltas,
      potBefore: 0,
      potAfter: 0,
    };
  }
  return round;
}

export function normalizeRounds(rounds, playerCount) {
  return (rounds || []).map((r) => normalizeRound(r, playerCount));
}

export function currentPot(rounds) {
  return rounds.length ? rounds[rounds.length - 1].potAfter || 0 : 0;
}

// joinedAt[i]: そのプレイヤーが参加した時点で完了していたラウンド数（最初からなら0）
export function computeCumulative(players, rounds, joinedAt = []) {
  const totals = zeros(players.length);
  const joined = (i, k) => k >= (joinedAt[i] || 0);
  const series = [
    Object.fromEntries([["round", 0], ["ポット", 0], ...players.map((p, i) => [p, joined(i, 0) ? 0 : null])]),
  ];
  rounds.forEach((round, rIdx) => {
    round.deltas.forEach((d, i) => {
      if (i < totals.length) totals[i] += d;
    });
    series.push(
      Object.fromEntries([
        ["round", rIdx + 1],
        ["ポット", round.potAfter || 0],
        ...players.map((p, i) => [p, joined(i, rIdx + 1) ? totals[i] : null]),
      ])
    );
  });
  return { series, totals };
}

export function computeRanked(players, totals) {
  return players
    .map((name, i) => ({ name, score: totals[i], idx: i }))
    .sort((a, b) => b.score - a.score);
}

// 全員を0にする精算（マイナスの人がプラスの人に払う）
export function computeSettlement(totals) {
  const debtors = [];
  const creditors = [];
  totals.forEach((score, idx) => {
    if (score < 0) debtors.push({ idx, amount: -score });
    else if (score > 0) creditors.push({ idx, amount: score });
  });
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);
  const transfers = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amount, creditors[ci].amount);
    if (pay > 0) transfers.push({ from: debtors[di].idx, to: creditors[ci].idx, amount: pay });
    debtors[di].amount -= pay;
    creditors[ci].amount -= pay;
    if (debtors[di].amount === 0) di++;
    if (creditors[ci].amount === 0) ci++;
  }
  return transfers;
}

// 倍マッチ: 今のラウンドで通知すべき倍マッチを返す
// doubleLog: { [予定ラウンド]: { targetRound, announced } }
export function activeDouble(roundNo, period, doubleLog) {
  const log = doubleLog || {};
  for (const [s, v] of Object.entries(log)) {
    if (v.targetRound === roundNo) return { scheduled: Number(s), announced: !!v.announced };
  }
  if (period > 0 && roundNo % period === 0 && !log[roundNo]) {
    return { scheduled: roundNo, announced: false };
  }
  return null;
}

export function nextDoubleRound(roundNo, period, doubleLog) {
  if (!(period > 0)) return null;
  const act = activeDouble(roundNo, period, doubleLog);
  if (act && !act.announced) return roundNo;
  let r = Math.ceil((roundNo + 1) / period) * period;
  return r;
}

// 統計
export function computeStats(players, rounds) {
  const n = players.length;
  const st = {
    declared: zeros(n),
    gotBacked: zeros(n),
    didBack: zeros(n),
    gained: zeros(n),
    lost: zeros(n),
    potWins: zeros(n),
    potGained: zeros(n),
    draws: 0,
    maxPot: 0,
  };
  rounds.forEach((r) => {
    if (r.type === "success" || r.type === "back") st.declared[r.declarer]++;
    if (r.type === "back") {
      st.gotBacked[r.declarer]++;
      (r.targets || []).forEach((t) => st.didBack[t]++);
    }
    if (r.type === "draw") st.draws++;
    st.maxPot = Math.max(st.maxPot, r.potAfter || 0, r.potBefore || 0);
    (r.potOut || []).forEach((v, i) => {
      if (v > 0) {
        st.potWins[i]++;
        st.potGained[i] += v;
      }
    });
    r.deltas.forEach((d, i) => {
      if (d > 0) st.gained[i] += d;
      else st.lost[i] += -d;
    });
  });
  return st;
}

// 次のラウンドで最初に出す人：直前のラウンドで一番多く支払った人（ポットへの支払いも含む）
// 同額で並んだらじゃんけん。誰も払っていなければ全員でじゃんけん
// 返り値: { who: [番号...], amount, all: 誰も払っていない }
export function nextStarter(round, playerCount) {
  if (!round) return null;
  const paid = zeros(playerCount);
  (round.transfers || []).forEach((t) => {
    if (t.from < playerCount) paid[t.from] += t.points;
  });
  (round.potIn || []).forEach((v, i) => {
    if (i < playerCount) paid[i] += v;
  });
  const max = Math.max(0, ...paid);
  if (max === 0) return { who: paid.map((_, i) => i), amount: 0, all: true };
  return { who: paid.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0), amount: max, all: false };
}

export function describeRound(r, players) {
  const name = (i) => players[i] ?? `P${i + 1}`;
  const parts = [];
  const head = ROUND_TYPE_LABEL[r.type] || r.type;
  if (r.type === "success" || r.type === "back") {
    parts.push(
      `${head} ${name(r.declarer)}(${r.declarerHand}) vs ${(r.targets || []).map(name).join("・")}(${r.targetHand})`
    );
  } else if (r.type === "draw") {
    parts.push(`${head} ${(r.hands || []).map((h, i) => `${name(i)} ${h}`).join("・")}`);
  } else {
    parts.push(head);
  }
  const moves = (r.transfers || []).map((t) => `${name(t.from)}→${name(t.to)} ${t.points}`);
  const potOut = (r.potOut || [])
    .map((v, i) => (v > 0 ? `ポット→${name(i)} ${v}` : null))
    .filter(Boolean);
  const potInSum = (r.potIn || []).reduce((a, b) => a + b, 0);
  if (potInSum > 0) moves.push(`ポットへ計${potInSum}`);
  return { head: parts[0], moves: [...moves, ...potOut] };
}

// CSV出力
export function buildCsv(players, rounds, joinedAt = []) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = [
    "round",
    "type",
    "multiplier",
    "declarer",
    "declarer_hand",
    "targets",
    "target_hand",
    "pot_before",
    "pot_after",
    "transfers",
    ...players.map((p) => `hand_${p}`),
    ...players.map((p) => `delta_${p}`),
    ...players.map((p) => `total_${p}`),
  ];
  const lines = [header.map(esc).join(",")];
  const totals = zeros(players.length);
  rounds.forEach((r, idx) => {
    r.deltas.forEach((d, i) => {
      if (i < totals.length) totals[i] += d;
    });
    const inGame = (i) => idx + 1 > (joinedAt[i] || 0);
    const deltas = players.map((_, i) => (inGame(i) ? r.deltas[i] || 0 : ""));
    const totalsOut = players.map((_, i) => (inGame(i) ? totals[i] : ""));
    const hands = zeros(players.length).map(() => "");
    if (r.type === "draw") (r.hands || []).forEach((h, i) => (hands[i] = h));
    if (r.type === "success" || r.type === "back") {
      hands[r.declarer] = r.declarerHand;
      (r.targets || []).forEach((t) => (hands[t] = r.targetHand));
    }
    const { moves } = describeRound(r, players);
    lines.push(
      [
        idx + 1,
        r.type,
        r.multiplier || 1,
        r.declarer !== undefined && r.declarer !== null ? players[r.declarer] : "",
        r.declarerHand ?? "",
        (r.targets || []).map((t) => players[t]).join("/"),
        r.targetHand ?? "",
        r.potBefore || 0,
        r.potAfter || 0,
        moves.join(" / "),
        ...hands,
        ...deltas,
        ...totalsOut,
      ]
        .map(esc)
        .join(",")
    );
  });
  return lines.join("\n");
}
