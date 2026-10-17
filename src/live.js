// ライブ共有：試合の要約を ntfy.sh（登録不要の中継サービス）経由で配る
// 試合側は変更のたびに要約を1通送り、閲覧側は「最新の1通＋以後の更新」を受け取る
import {
  computeCumulative,
  computeStats,
  describeRound,
  currentPot,
  activeDouble,
  nextDoubleRound,
} from "./logic.js";

export const LIVE_BASE = (import.meta.env && import.meta.env.VITE_LIVE_BASE) || "https://ntfy.sh";
const TOPIC_PREFIX = "yaniv-live-";
export const MAX_BYTES = 3900; // ntfy.sh の1通の上限は4096バイト。余裕を持たせる

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // 紛らわしい文字（i,l,o,0,1）を除く

export function newRoomCode(len = 12) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export const isValidCode = (code) => typeof code === "string" && /^[a-z0-9]{6,32}$/.test(code);
export const topicOf = (code) => TOPIC_PREFIX + code;
export const formatCode = (code) => (code || "").replace(/(.{4})(?=.)/g, "$1-");
export const normalizeCode = (text) => {
  const t = (text || "").trim();
  const m = t.match(/[?&]live=([a-z0-9]+)/i);
  return (m ? m[1] : t).toLowerCase().replace(/[^a-z0-9]/g, "");
};

export function liveUrl(code) {
  const origin = typeof location !== "undefined" ? location.origin : "https://yaniv-scorer.vercel.app";
  return `${origin}/?live=${code}`;
}

const byteLength = (s) => new TextEncoder().encode(s).length;

// ===== 要約を作る =====
// 1ラウンドを短い記号で表す：s=成功 b=返し d=流局 m=手入力、倍率>1なら数字、返しは「:宣言者番号」
function markOf(r) {
  const t = { success: "s", back: "b", draw: "d", manual: "m" }[r.type] || "m";
  const x = (r.multiplier || 1) > 1 ? String(r.multiplier) : "";
  const d = r.type === "back" ? `:${r.declarer}` : "";
  return t + x + d;
}

export function parseMark(token) {
  const m = /^([sbdm])(\d)?(?::(\d+))?$/.exec(token || "");
  if (!m) return { type: "manual", multiplier: 1 };
  const type = { s: "success", b: "back", d: "draw", m: "manual" }[m[1]];
  return { type, multiplier: m[2] ? Number(m[2]) : 1, ...(m[3] !== undefined ? { declarer: Number(m[3]) } : {}) };
}

export function buildSnapshot(current, { ended = false } = {}) {
  const players = current.players || [];
  const rounds = current.rounds || [];
  const joinedAt = current.joinedAt || [];
  const settings = current.settings || {};
  const roundNo = rounds.length + 1;
  const cum = computeCumulative(players, rounds, joinedAt);
  const st = computeStats(players, rounds);
  const dbl = current.phase === "play" ? activeDouble(roundNo, settings.doublePeriod, current.doubleLog) : null;
  const last = rounds[rounds.length - 1];
  return {
    k: "yaniv",
    v: 1,
    at: Date.now(),
    end: ended || undefined,
    ph: current.phase,
    st: current.startedAt || null,
    ps: players,
    j: joinedAt,
    t: cum.totals,
    r: rounds.length,
    pot: currentPot(rounds),
    pe: !!settings.potEnabled,
    dp: settings.doublePeriod || 0,
    dl: settings.declareLine ?? 5,
    dk: settings.deckCount || 1,
    dbl: dbl ? { s: dbl.scheduled, a: dbl.announced } : null,
    nd: current.phase === "play" ? nextDoubleRound(roundNo, settings.doublePeriod, current.doubleLog) : null,
    ld: last ? players.map((_, i) => last.deltas[i] || 0) : null,
    // 直近のラウンド（新しい順）：[番号, 倍率, 見出し, 点の動き]
    lr: rounds
      .map((r, i) => ({ r, i }))
      .slice(-6)
      .reverse()
      .map(({ r, i }) => {
        const d = describeRound(r, players);
        return [i + 1, r.multiplier || 1, d.head, d.moves.join(" / ")];
      }),
    mk: rounds.map(markOf).join(","),
    // 推移：x=ラウンド番号、y=各プレイヤーの累計（参加前はnull）
    se: {
      x: cum.series.map((p) => p.round),
      y: cum.series.map((p) => players.map((n) => p[n])),
      pot: cum.series.map((p) => p["ポット"] || 0),
    },
    sx: { d: st.declared, gb: st.gotBacked, db: st.didBack, pw: st.potWins, dr: st.draws, mp: st.maxPot },
  };
}

// 推移を間引く（最初と最後は必ず残す）
function thinSeries(se, step) {
  const keep = se.x.map((_, i) => i === 0 || i === se.x.length - 1 || i % step === 0);
  return {
    x: se.x.filter((_, i) => keep[i]),
    y: se.y.filter((_, i) => keep[i]),
    pot: se.pot.filter((_, i) => keep[i]),
  };
}

// 4KBに収まるまで、推移の間引き→直近ラウンドの削減→推移の省略の順で軽くする
export function encodeSnapshot(snap) {
  let s = { ...snap };
  let out = JSON.stringify(s);
  if (byteLength(out) <= MAX_BYTES) return out;
  for (const step of [2, 3, 4, 6, 8, 12, 16, 24, 32]) {
    s = { ...snap, se: thinSeries(snap.se, step) };
    out = JSON.stringify(s);
    if (byteLength(out) <= MAX_BYTES) return out;
  }
  for (const n of [3, 1]) {
    s = { ...s, lr: snap.lr.slice(0, n) };
    out = JSON.stringify(s);
    if (byteLength(out) <= MAX_BYTES) return out;
  }
  s = { ...s, se: null, mk: "" };
  out = JSON.stringify(s);
  if (byteLength(out) <= MAX_BYTES) return out;
  s = { ...s, lr: [] };
  return JSON.stringify(s);
}

export function decodeSnapshot(text) {
  try {
    const s = JSON.parse(text);
    if (!s || s.k !== "yaniv" || s.v !== 1 || !Array.isArray(s.ps)) return null;
    return s;
  } catch {
    return null;
  }
}

// ===== 送信 =====
export async function publishSnapshot(code, body) {
  // 独自ヘッダーを付けるとプリフライトが発生するので、オプションはURLで渡す（firebase=no：プッシュ通知に流さない）
  const res = await fetch(`${LIVE_BASE}/${topicOf(code)}?firebase=no`, {
    method: "POST",
    body,
  });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return true;
}

// ===== 受信 =====
const pickMessage = (obj) => (obj && obj.event === "message" && typeof obj.message === "string" ? obj.message : null);

export async function fetchLatest(code) {
  const res = await fetch(`${LIVE_BASE}/${topicOf(code)}/json?poll=1&since=latest`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const lines = (await res.text()).split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const m = pickMessage(JSON.parse(lines[i]));
      const snap = m && decodeSnapshot(m);
      if (snap) return snap;
    } catch {}
  }
  return null;
}

// 最新の1通をもらってから以後の更新を待つ。切れたら自動で張り直し、だめなら定期取得に切り替える
export function subscribe(code, { onSnapshot, onStatus }) {
  let es = null;
  let stopped = false;
  let pollTimer = null;
  let errorSince = null;

  const handle = (snap) => {
    if (snap) onSnapshot(snap);
  };

  const poll = async () => {
    try {
      handle(await fetchLatest(code));
      onStatus("polling");
    } catch {
      onStatus("error");
    }
  };

  const startPolling = () => {
    if (pollTimer) return;
    poll();
    pollTimer = setInterval(poll, 15000);
  };
  const stopPolling = () => {
    clearInterval(pollTimer);
    pollTimer = null;
  };

  const open = () => {
    if (stopped) return;
    if (es) es.close();
    onStatus("connecting");
    if (typeof EventSource === "undefined") {
      startPolling();
      return;
    }
    es = new EventSource(`${LIVE_BASE}/${topicOf(code)}/sse?since=latest`);
    es.onopen = () => {
      errorSince = null;
      stopPolling();
      onStatus("live");
    };
    es.onmessage = (e) => {
      try {
        const m = pickMessage(JSON.parse(e.data));
        if (m) handle(decodeSnapshot(m));
        onStatus("live");
      } catch {}
    };
    es.onerror = () => {
      if (stopped) return;
      onStatus("reconnecting");
      if (!errorSince) errorSince = Date.now();
      // 20秒つながらなければ定期取得も並行して行う
      if (Date.now() - errorSince > 20000) startPolling();
    };
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") open();
  };

  open();
  // 長くつながらない場合に備えて最初から1回だけ取得しておく
  fetchLatest(code)
    .then(handle)
    .catch(() => {});
  document.addEventListener("visibilitychange", onVisible);

  return () => {
    stopped = true;
    if (es) es.close();
    stopPolling();
    document.removeEventListener("visibilitychange", onVisible);
  };
}
