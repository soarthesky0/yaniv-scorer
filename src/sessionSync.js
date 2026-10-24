// 複数卓セッションの端末間同期（ntfy.sh 経由）
// ・各端末は自分が作った出来事を送り、同じセッションの全端末が受け取って取り込む
// ・送れなかった出来事は「未送信」として溜め、つながったら送る
// ・あとから参加した端末は「hello」を送り、セッションを作った端末が全部を送り直す
import { useEffect, useRef, useState } from "react";
import { LIVE_BASE } from "./live.js";

const PREFIX = "yaniv-sess-";
const MAX_BYTES = 3800;
export const sessionTopic = (sid) => PREFIX + sid;
export const isValidSid = (sid) => typeof sid === "string" && /^[a-z0-9]{8,32}$/.test(sid);
export function joinUrl(sid) {
  const origin = typeof location !== "undefined" ? location.origin : "https://yaniv-scorer.vercel.app";
  return `${origin}/?join=${sid}`;
}

const bytes = (s) => new TextEncoder().encode(s).length;

// 1通4KBに収まるように出来事を束ねる
export function packBatches(events) {
  const out = [];
  let cur = [];
  const size = (list) => bytes(JSON.stringify({ k: "ys", v: 1, es: list }));
  for (const e of events) {
    if (cur.length && size([...cur, e]) > MAX_BYTES) {
      out.push(cur);
      cur = [];
    }
    cur.push(e);
  }
  if (cur.length) out.push(cur);
  return out;
}

// その場で送る（セッションを閉じる直前など、未送信の仕組みを待てないとき）
export async function publishNow(sid, events, dev) {
  for (const batch of packBatches(events)) await post(sid, { k: "ys", v: 1, dev, es: batch });
}

async function post(sid, payload) {
  const res = await fetch(`${LIVE_BASE}/${sessionTopic(sid)}?firebase=no`, { method: "POST", body: JSON.stringify(payload) });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

// sid: セッションID / on: 同期するか / events: 手元の出来事 / pending: 未送信の出来事ID
// onReceive(events, msgId): 届いた出来事 / onSent(ids): 送れた出来事
export function useSessionSync({ sid, on, events, pending, devId, isHost, joining, onReceive, onSent }) {
  const [conn, setConn] = useState("idle"); // idle | connecting | live | offline
  const [sendError, setSendError] = useState(false);
  const ref = useRef({});
  ref.current = { events, pending, isHost, onReceive, onSent, devId };
  const sending = useRef(false);
  const retryTimer = useRef(null);
  const failures = useRef(0);
  const lastMsgId = useRef(null);

  const flush = async () => {
    clearTimeout(retryTimer.current);
    if (!on || !sid || sending.current) return;
    const { events: evs, pending: pend } = ref.current;
    const todo = evs.filter((e) => pend.includes(e.id));
    if (!todo.length) return;
    sending.current = true;
    try {
      for (const batch of packBatches(todo)) {
        await post(sid, { k: "ys", v: 1, dev: ref.current.devId, es: batch });
        ref.current.onSent(batch.map((e) => e.id));
      }
      failures.current = 0;
      setSendError(false);
    } catch (e) {
      failures.current += 1;
      setSendError(true);
      // 回数制限（429）のときは長めに待つ
      const wait = Math.min(60000, (e.status === 429 ? 10000 : 3000) * 2 ** (failures.current - 1));
      retryTimer.current = setTimeout(flush, wait);
    } finally {
      sending.current = false;
    }
  };

  const republishAll = async () => {
    const all = ref.current.events;
    try {
      for (const batch of packBatches(all)) await post(sid, { k: "ys", v: 1, dev: ref.current.devId, es: batch });
    } catch {}
  };

  // 受信
  useEffect(() => {
    if (!on || !sid) return;
    let stopped = false;
    let es = null;
    let pollTimer = null;
    let helloSent = false;

    const handle = (raw) => {
      let m;
      try {
        m = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        return;
      }
      if (!m || m.event !== "message" || typeof m.message !== "string") return;
      lastMsgId.current = m.id;
      let p;
      try {
        p = JSON.parse(m.message);
      } catch {
        return;
      }
      if (!p || p.k !== "ys") return;
      if (Array.isArray(p.es) && p.es.length) ref.current.onReceive(p.es, m.id);
      // あとから参加した端末への送り直し（セッションを作った端末が担当）
      if (p.hello && p.dev !== ref.current.devId && ref.current.isHost && (p.have || 0) < ref.current.events.length) {
        republishAll();
      }
    };

    const sendHello = () => {
      if (helloSent) return;
      helloSent = true;
      post(sid, { k: "ys", v: 1, hello: true, dev: ref.current.devId, have: ref.current.events.length }).catch(() => {
        helloSent = false;
      });
    };

    const poll = async () => {
      try {
        const since = lastMsgId.current || "all";
        const res = await fetch(`${LIVE_BASE}/${sessionTopic(sid)}/json?poll=1&since=${since}`, { cache: "no-store" });
        if (!res.ok) throw new Error();
        (await res.text())
          .split("\n")
          .filter(Boolean)
          .forEach(handle);
        setConn("live");
      } catch {
        setConn("offline");
      }
    };

    const open = () => {
      if (stopped) return;
      if (es) es.close();
      setConn((c) => (c === "live" ? c : "connecting"));
      if (typeof EventSource === "undefined") {
        poll();
        pollTimer = pollTimer || setInterval(poll, 10000);
        return;
      }
      es = new EventSource(`${LIVE_BASE}/${sessionTopic(sid)}/sse?since=${lastMsgId.current || "all"}`);
      es.onopen = () => {
        setConn("live");
        clearInterval(pollTimer);
        pollTimer = null;
        if (joining) sendHello();
        flush();
      };
      es.onmessage = (ev) => handle(ev.data);
      es.onerror = () => {
        if (stopped) return;
        setConn("offline");
        if (!pollTimer) pollTimer = setInterval(poll, 15000);
      };
    };

    const wake = () => {
      if (document.visibilityState === "visible") {
        open();
        failures.current = 0;
        flush();
      }
    };
    const online = () => {
      open();
      failures.current = 0;
      flush();
    };
    open();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", online);
    return () => {
      stopped = true;
      if (es) es.close();
      clearInterval(pollTimer);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", online);
    };
  }, [on, sid, joining]);

  // 未送信があれば送る
  useEffect(() => {
    if (on && pending && pending.length) flush();
  }, [on, sid, pending && pending.length]);

  useEffect(() => () => clearTimeout(retryTimer.current), []);

  return { conn, sendError, pendingCount: (pending || []).length, retry: flush };
}
