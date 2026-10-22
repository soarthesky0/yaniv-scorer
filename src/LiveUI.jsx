import React, { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { Shell, Header, Dot, ScoreChart, StatsBoard, NextStarter, styles, PLAYER_COLORS } from "./App.jsx";
import { RulesSheet, RulesFab } from "./RulesPages.jsx";
import { computeSettlement } from "./logic.js";
import {
  buildSnapshot,
  encodeSnapshot,
  publishSnapshot,
  subscribe,
  liveUrl,
  formatCode,
  parseMark,
} from "./live.js";

const GREEN = "#14953F";
const RED = "#E03131";
const AMBER = "#C99100";

// ============ 試合側：変更のたびに送る ============
// live: { code, on }。送信は直前の送信から最低1.5秒あけ、失敗したら間隔を広げて再送する
export function useLivePublisher(live, current) {
  const [status, setStatus] = useState({ state: "idle", at: null });
  const lastSent = useRef(null); // 前回送った内容（at以外）
  const pending = useRef(null);
  const timer = useRef(null);
  const lastAt = useRef(0);
  const failures = useRef(0);
  const sending = useRef(false);

  const flush = async () => {
    timer.current = null;
    if (!pending.current || sending.current) return;
    const wait = lastAt.current + 1500 - Date.now();
    if (wait > 0) {
      timer.current = setTimeout(flush, wait);
      return;
    }
    const { code, body, key } = pending.current;
    sending.current = true;
    setStatus((s) => ({ ...s, state: "sending" }));
    try {
      await publishSnapshot(code, body);
      lastAt.current = Date.now();
      failures.current = 0;
      lastSent.current = key;
      if (pending.current && pending.current.key === key) pending.current = null;
      setStatus({ state: "ok", at: Date.now() });
    } catch (e) {
      failures.current += 1;
      lastAt.current = Date.now();
      const backoff = Math.min(60000, 5000 * 2 ** (failures.current - 1));
      setStatus({ state: "error", at: null, retryIn: backoff, code: e.status || null });
      timer.current = setTimeout(flush, backoff);
    } finally {
      sending.current = false;
      if (pending.current && !timer.current) timer.current = setTimeout(flush, 0);
    }
  };

  const queue = (code, snap) => {
    const { at, ...rest } = snap;
    const key = code + JSON.stringify(rest);
    if (key === lastSent.current && !pending.current) return;
    pending.current = { code, body: encodeSnapshot(snap), key };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, failures.current ? 0 : 700);
  };

  // 試合内容が変わるたびに送る
  useEffect(() => {
    if (!live || !live.on || !live.code) return;
    queue(live.code, buildSnapshot(current));
  }, [live && live.on, live && live.code, current]);

  // アプリに戻ってきたとき、送れていないものがあればすぐ送る
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && pending.current) {
        failures.current = 0;
        lastAt.current = 0;
        clearTimeout(timer.current);
        flush();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  // 共有をやめるときは「終了」を1通送る（届かなくても止める）
  const sendEnd = async (code) => {
    clearTimeout(timer.current);
    pending.current = null;
    lastSent.current = null;
    try {
      await publishSnapshot(code, encodeSnapshot(buildSnapshot(current, { ended: true })));
    } catch {}
    setStatus({ state: "idle", at: null });
  };

  return { status, sendEnd };
}

function useNow(interval = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), interval);
    return () => clearInterval(t);
  }, [interval]);
  return now;
}

const ago = (at, now) => {
  if (!at) return "";
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 10) return "たった今";
  if (s < 60) return `${s}秒前`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}分前` : `${Math.round(m / 60)}時間前`;
};

// ============ 試合側：ライブ共有の帯 ============
export function LiveBar({ live, status, onOpen }) {
  const now = useNow();
  if (!live || !live.on) {
    return (
      <button onClick={onOpen} style={{ ...styles.homeLink, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <span>
          <span style={{ display: "block", fontSize: 15, fontWeight: 800 }}>ライブ共有</span>
          <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>他のスマホで点数をリアルタイムに見られる</span>
        </span>
        <span style={{ fontSize: 13, fontWeight: 800, color: "#666" }}>始める →</span>
      </button>
    );
  }
  const err = status.state === "error";
  const color = err ? RED : GREEN;
  return (
    <button
      onClick={onOpen}
      style={{
        ...styles.homeLink,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        boxShadow: `inset 0 0 0 2px ${color}`,
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            background: color,
            animation: err ? "none" : "livePulse 1.6s ease-in-out infinite",
          }}
        />
        <span>
          <span style={{ display: "block", fontSize: 15, fontWeight: 800, color }}>
            {err ? "ライブ共有：送信できていません" : "ライブ共有中"}
          </span>
          <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>
            {err
              ? "電波が戻れば自動で再送します"
              : status.state === "ok"
                ? `最終送信 ${ago(status.at, now)}`
                : "送信中…"}
          </span>
        </span>
      </span>
      <span style={{ fontSize: 13, fontWeight: 800, color: "#666" }}>QR →</span>
    </button>
  );
}

function QrImage({ text, size = 220 }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#1a1a1a", light: "#ffffff" } })
      .then(setSvg)
      .catch(() => setSvg(""));
  }, [text]);
  return (
    <div
      style={{ width: size, height: size, margin: "0 auto", background: "#fff", borderRadius: 8, overflow: "hidden" }}
      dangerouslySetInnerHTML={{ __html: svg.replace("<svg ", `<svg width="${size}" height="${size}" `) }}
    />
  );
}

// ============ 試合側：QRとリンクのシート ============
export function LiveSheet({ live, status, onStart, onStop, onRenew, onClose }) {
  const url = live && live.code ? liveUrl(live.code) : "";
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "ヤニブのライブ", url });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      prompt("このリンクをコピーしてください", url);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.35)",
        zIndex: 50,
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          width: "100%",
          maxWidth: 520,
          borderRadius: "14px 14px 0 0",
          padding: "20px 20px calc(env(safe-area-inset-bottom, 0px) + 24px)",
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ ...styles.h2, margin: 0 }}>ライブ共有</h2>
          <button onClick={onClose} style={styles.headerBtn}>
            閉じる
          </button>
        </div>

        {!live || !live.on ? (
          <div style={{ display: "grid", gap: 12 }}>
            <p style={{ fontSize: 14, lineHeight: 1.7, margin: 0 }}>
              始めると、この試合の累計・ポット・ラウンド・グラフを、QRコードやリンクを開いた人のスマホで見られるようになります。見る側は表示だけで、入力はできません。
            </p>
            <ul style={{ fontSize: 12, color: "#666", lineHeight: 1.7, margin: 0, paddingLeft: 18 }}>
              <li>中継には登録不要の公開サービス（ntfy.sh）を使います</li>
              <li>リンクを知っている人なら誰でも見られます（名前と点数が見えます）</li>
              <li>このスマホが電波の届かない場所にいる間は更新が止まり、戻れば自動で再送します</li>
            </ul>
            <button onClick={onStart} style={styles.primary}>
              ライブ共有を始める
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            <QrImage text={url} />
            <div style={{ textAlign: "center" }}>
              <div style={{ ...styles.miniLabel }}>コード</div>
              <div style={{ fontSize: 22, fontWeight: 900, fontFamily: "monospace", letterSpacing: "0.04em" }}>
                {formatCode(live.code)}
              </div>
              <div style={{ fontSize: 11, color: "#999", wordBreak: "break-all", marginTop: 4 }}>{url}</div>
            </div>
            <button onClick={share} style={styles.primary}>
              {copied ? "コピーしました" : "リンクを送る"}
            </button>
            <div style={{ fontSize: 12, color: status.state === "error" ? RED : "#666", textAlign: "center" }}>
              {status.state === "error"
                ? "送信できていません。電波が戻れば自動で再送します"
                : status.state === "ok"
                  ? "送信できています"
                  : "送信中…"}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <button onClick={onRenew} style={styles.secondary}>
                リンクを作り直す
              </button>
              <button onClick={onStop} style={styles.danger}>
                共有をやめる
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#aaa", lineHeight: 1.6 }}>
              新しい試合を始めても同じリンクのまま見られます。前のリンクを使えなくしたいときは「リンクを作り直す」を押してください。
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ============ 閲覧側 ============
const STATUS_LABEL = {
  connecting: { text: "接続中", color: AMBER },
  live: { text: "受信中", color: GREEN },
  polling: { text: "受信中（定期取得）", color: GREEN },
  reconnecting: { text: "再接続中", color: AMBER },
  error: { text: "接続できません", color: RED },
};

export function LiveViewer({ code }) {
  const [snap, setSnap] = useState(null);
  const [conn, setConn] = useState("connecting");
  const [rulesTab, setRulesTab] = useState(null);
  const latestAt = useRef(0);
  const now = useNow(5000);

  useEffect(() => {
    document.title = "ヤニブ LIVE";
    return subscribe(code, {
      onSnapshot: (s) => {
        if (s.at >= latestAt.current) {
          latestAt.current = s.at;
          setSnap(s);
        }
      },
      onStatus: setConn,
    });
  }, [code]);

  const st = STATUS_LABEL[conn] || STATUS_LABEL.connecting;
  const players = snap ? snap.ps : [];
  const ranked = useMemo(
    () =>
      snap
        ? snap.ps.map((name, idx) => ({ name, idx, score: snap.t[idx] ?? 0 })).sort((a, b) => b.score - a.score)
        : [],
    [snap]
  );
  const series = useMemo(() => {
    if (!snap || !snap.se) return [];
    return snap.se.x.map((round, k) =>
      Object.fromEntries([["round", round], ["ポット", snap.se.pot[k] || 0], ...snap.ps.map((n, i) => [n, snap.se.y[k][i]])])
    );
  }, [snap]);
  const markRounds = useMemo(() => (snap && snap.mk ? snap.mk.split(",").map(parseMark) : []), [snap]);
  const stale = snap && now - snap.at > 15 * 60 * 1000;

  return (
    <Shell>
      <Header
        title="LIVE"
        right={
          <span style={{ ...styles.headerBtn, display: "flex", alignItems: "center", gap: 8, cursor: "default" }}>
            <span style={{ width: 9, height: 9, borderRadius: 5, background: st.color }} />
            <span style={{ fontSize: 13 }}>{st.text}</span>
          </span>
        }
      />
      <p style={{ ...styles.sub, textTransform: "none", letterSpacing: "0.02em" }}>
        ヤニブ得点計算機 · 見るだけの画面 · {formatCode(code)}
      </p>

      {!snap && (
        <div style={{ ...styles.card, textAlign: "center", padding: "36px 20px" }}>
          <div style={{ fontSize: 16, fontWeight: 800 }}>
            {conn === "error" ? "接続できません" : "試合のデータを待っています"}
          </div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 8, lineHeight: 1.7 }}>
            試合側のスマホでライブ共有が始まっていれば、まもなく表示されます。
            <br />
            しばらく表示されない場合は、リンクが正しいか確認してください。
          </div>
        </div>
      )}

      {snap && snap.end && (
        <div style={{ ...styles.card, background: "#1a1a1a", color: "#fff", border: "none", textAlign: "center" }}>
          <div style={{ fontSize: 15, fontWeight: 800 }}>ライブ共有は終了しました</div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>最後の状態を表示しています</div>
        </div>
      )}

      {snap && (
        <div style={{ fontSize: 12, color: stale ? RED : "#999", textAlign: "right", marginTop: -6 }}>
          最終更新 {ago(snap.at, now)}
          {stale ? "（しばらく更新がありません）" : ""}
        </div>
      )}

      {snap && snap.ph === "setup" && !snap.end && (
        <div style={{ ...styles.card, textAlign: "center", padding: "30px 20px" }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>次の試合を準備中</div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>始まると自動で表示されます</div>
        </div>
      )}

      {snap && snap.ph !== "setup" && players.length > 0 && (
        <>
          <div style={{ ...styles.card, display: "flex", alignItems: "stretch", padding: 0, overflow: "hidden" }}>
            <div style={{ flex: 1, padding: "14px 18px" }}>
              <div style={styles.miniLabel}>{snap.ph === "result" ? "FINAL" : "ROUND"}</div>
              <div style={styles.bigNum}>{snap.ph === "result" ? snap.r : snap.r + 1}</div>
              <div style={{ fontSize: 11, color: "#999" }}>
                {snap.ph === "result"
                  ? `${snap.r}ラウンドで終了`
                  : snap.nd
                    ? `倍マッチ：${snap.nd === snap.r + 1 ? "今回" : `R${snap.nd}`}`
                    : `${snap.r}ラウンド終了`}
              </div>
            </div>
            {snap.pe && (
              <div
                style={{
                  flex: 1,
                  padding: "14px 18px",
                  background: snap.pot > 0 ? "#1a1a1a" : "#f7f5ef",
                  color: snap.pot > 0 ? "#f4f1ea" : "#1a1a1a",
                  borderLeft: "1px solid #e5e2da",
                }}
              >
                <div style={{ ...styles.miniLabel, color: snap.pot > 0 ? "#b9b4a6" : "#888" }}>POT</div>
                <div style={styles.bigNum}>{snap.pot}</div>
                <div style={{ fontSize: 11, opacity: 0.6 }}>流局ポット</div>
              </div>
            )}
          </div>

          {snap.ph === "play" && snap.dbl && (
            <div
              style={{
                ...styles.card,
                padding: "12px 16px",
                background: snap.dbl.a ? "#fff5f5" : "#E63946",
                color: snap.dbl.a ? "#E63946" : "#fff",
                border: "none",
                boxShadow: "inset 0 0 0 2px #E63946",
                fontWeight: 800,
              }}
            >
              {snap.dbl.a ? "倍マッチ中" : "倍マッチのラウンド（アナウンス待ち）"}
            </div>
          )}

          {snap.ph === "play" && snap.ns && (
            <NextStarter players={players} info={{ who: snap.ns.w, amount: snap.ns.a, all: snap.ns.all }} prevRound={snap.r} />
          )}

          <div style={styles.card}>
            <h2 style={styles.h2}>{snap.ph === "result" ? "最終順位" : "順位"}</h2>
            <div style={{ display: "grid", gap: 2 }}>
              {ranked.map((r, i) => {
                const d = snap.ld ? snap.ld[r.idx] : 0;
                return (
                  <div
                    key={r.idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 0",
                      borderBottom: i === ranked.length - 1 ? "none" : "1px solid #f0ede5",
                    }}
                  >
                    <span style={{ width: 20, fontSize: 13, fontWeight: 900, color: "#999" }}>{i + 1}</span>
                    <Dot idx={r.idx} />
                    <span style={{ fontWeight: 700, fontSize: 16, flex: 1, minWidth: 0 }}>
                      {r.name}
                      {(snap.j?.[r.idx] || 0) > 0 && (
                        <span style={{ fontSize: 11, color: "#999", fontWeight: 600, marginLeft: 6 }}>
                          R{snap.j[r.idx] + 1}から
                        </span>
                      )}
                    </span>
                    {d !== 0 && (
                      <span style={{ fontSize: 12, fontWeight: 800, color: d > 0 ? GREEN : RED, fontFamily: "monospace" }}>
                        {d > 0 ? `+${d}` : d}
                      </span>
                    )}
                    <span style={{ fontFamily: "monospace", fontSize: 19, fontWeight: 800, minWidth: 56, textAlign: "right" }}>
                      {r.score}
                    </span>
                  </div>
                );
              })}
            </div>
            {snap.ld && <div style={{ fontSize: 11, color: "#aaa", marginTop: 6 }}>小さい数字は直前のラウンドの増減</div>}
          </div>

          {snap.ph === "result" && <SettlementCard players={players} totals={snap.t} pot={snap.pot} />}

          {snap.lr && snap.lr.length > 0 && (
            <div style={styles.card}>
              <h2 style={styles.h2}>直近のラウンド</h2>
              <div style={{ display: "grid", gap: 8 }}>
                {snap.lr.map(([n, mult, head, moves]) => (
                  <div key={n} style={{ padding: "8px 10px", background: "#f7f5ef", borderRadius: 6, fontSize: 13 }}>
                    <div>
                      <strong>R{n}</strong>
                      {mult > 1 && <span style={{ color: "#E63946", fontWeight: 800, marginLeft: 6 }}>×{mult}</span>} {head}
                    </div>
                    {moves && <div style={{ color: "#666", marginTop: 2 }}>{moves}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {series.length > 1 && (
            <div style={styles.card} className="bleed">
              <h2 style={styles.h2}>推移</h2>
              <ScoreChart players={players} data={series} rounds={markRounds} showPot={snap.pe} height={240} />
            </div>
          )}

          {snap.sx && (
            <div style={styles.card}>
              <h2 style={styles.h2}>統計</h2>
              <StatsBoard players={players} st={statsFromSnap(snap.sx, players.length)} potEnabled={snap.pe} />
            </div>
          )}
        </>
      )}

      <a
        href="/"
        style={{ ...styles.secondary, display: "block", textAlign: "center", textDecoration: "none", boxSizing: "border-box" }}
      >
        自分でアプリを使う →
      </a>

      {!rulesTab && <RulesFab onOpen={() => setRulesTab("rules")} />}
      {rulesTab && (
        <RulesSheet
          tab={rulesTab}
          setTab={setRulesTab}
          settings={{
            potEnabled: snap ? snap.pe : false,
            doublePeriod: snap ? snap.dp : 10,
            declareLine: snap ? snap.dl : 5,
            deckCount: snap ? snap.dk : 1,
          }}
          playerCount={players.length}
          onClose={() => setRulesTab(null)}
        />
      )}
    </Shell>
  );
}

function SettlementCard({ players, totals, pot }) {
  const list = computeSettlement(totals);
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>精算 — 全員を0にする</h2>
      {list.length === 0 ? (
        <p style={{ color: "#999", fontSize: 14, margin: 0 }}>精算は不要です。</p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {list.map((s, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#f7f5ef", borderRadius: 6 }}
            >
              <Dot idx={s.from} size={9} />
              <strong>{players[s.from]}</strong>
              <span style={{ color: "#999" }}>→</span>
              <Dot idx={s.to} size={9} />
              <strong>{players[s.to]}</strong>
              <span style={{ marginLeft: "auto", fontFamily: "monospace", fontWeight: 800 }}>{s.amount}</span>
            </div>
          ))}
        </div>
      )}
      {pot > 0 && <div style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>ポット残高{pot}点は精算に含みません</div>}
    </div>
  );
}

// 送られてきた統計を試合側と同じ形に戻す（古い形式で届いた項目は0）
function statsFromSnap(sx, n) {
  const z = Array(n).fill(0);
  const arr = (v) => (Array.isArray(v) ? v : z);
  return {
    declared: arr(sx.d),
    gotBacked: arr(sx.gb),
    didBack: arr(sx.db),
    gained: arr(sx.g),
    lost: arr(sx.l),
    potWins: arr(sx.pw),
    potGained: arr(sx.pg),
    draws: sx.dr || 0,
    maxPot: sx.mp || 0,
  };
}
