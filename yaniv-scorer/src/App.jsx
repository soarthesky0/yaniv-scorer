import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { toPng } from "html-to-image";

const PLAYER_COLORS = [
  "#E63946",
  "#1D3557",
  "#2A9D8F",
  "#F4A261",
  "#9D4EDD",
  "#06A77D",
  "#D62828",
  "#118AB2",
  "#E76F51",
  "#457B9D",
  "#B5179E",
  "#7B6F00",
];

const STORAGE_KEY = "yaniv-scorer-v2";

const emptyCurrent = () => ({
  phase: "setup", // setup | play | result
  numPlayers: 4,
  players: [],
  rounds: [],
  nameInputs: Array(12)
    .fill(0)
    .map((_, i) => `P${i + 1}`),
  startedAt: null,
});

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { current: emptyCurrent(), history: [] };
    const parsed = JSON.parse(raw);
    return {
      current: { ...emptyCurrent(), ...(parsed.current || {}) },
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { current: emptyCurrent(), history: [] };
  }
}

function saveStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {}
}

// ===== 計算ユーティリティ =====
function computeCumulative(players, rounds) {
  const totals = Array(players.length).fill(0);
  const series = [
    Object.fromEntries([
      ["round", 0],
      ...players.map((p) => [p, 0]),
    ]),
  ];
  rounds.forEach((round, rIdx) => {
    round.forEach((t) => {
      totals[t.from] -= t.points;
      totals[t.to] += t.points;
    });
    series.push(
      Object.fromEntries([
        ["round", rIdx + 1],
        ...players.map((p, i) => [p, totals[i]]),
      ])
    );
  });
  return { series, totals };
}

function computeRanked(players, totals) {
  return players
    .map((name, i) => ({ name, score: totals[i], idx: i }))
    .sort((a, b) => b.score - a.score); // プラスが大きい人が1位
}

// 全員を0にするための精算（最小送金）を計算
// マイナスの人（負債者）がプラスの人（債権者）に払う方向で返す
function computeSettlement(players, totals) {
  // 端数・浮動小数を避けるため整数前提。debtors=払う側, creditors=受け取る側
  const debtors = []; // score < 0
  const creditors = []; // score > 0
  totals.forEach((score, idx) => {
    if (score < 0) debtors.push({ idx, amount: -score }); // 払うべき額（正の値）
    else if (score > 0) creditors.push({ idx, amount: score }); // 受け取るべき額
  });
  // 大きい順に並べて貪欲にマッチング（送金回数を抑える）
  debtors.sort((a, b) => b.amount - a.amount);
  creditors.sort((a, b) => b.amount - a.amount);

  const transfers = [];
  let di = 0;
  let ci = 0;
  while (di < debtors.length && ci < creditors.length) {
    const pay = Math.min(debtors[di].amount, creditors[ci].amount);
    if (pay > 0) {
      transfers.push({
        from: debtors[di].idx, // マイナスの人（払う）
        to: creditors[ci].idx, // プラスの人（受け取る）
        amount: pay,
      });
    }
    debtors[di].amount -= pay;
    creditors[ci].amount -= pay;
    if (debtors[di].amount === 0) di++;
    if (creditors[ci].amount === 0) ci++;
  }
  return transfers;
}

export default function App() {
  const initial = loadStore();
  const [current, setCurrent] = useState(initial.current);
  const [history, setHistory] = useState(initial.history);
  // view: "main" | { type: "history-list" } | { type: "history-detail", id }
  const [view, setView] = useState("main");

  // 自動保存（current/history変化のたび）
  useEffect(() => {
    saveStore({ current, history });
  }, [current, history]);

  // currentの更新ヘルパ
  const updateCurrent = useCallback((patch) => {
    setCurrent((prev) => ({ ...prev, ...patch }));
  }, []);

  // ===== ゲーム遷移 =====
  const startGame = () => {
    const names = current.nameInputs
      .slice(0, current.numPlayers)
      .map((n, i) => n.trim() || `P${i + 1}`);
    updateCurrent({
      players: names,
      rounds: [],
      phase: "play",
      startedAt: new Date().toISOString(),
    });
  };

  const goResult = () => {
    if (current.rounds.length === 0) return;
    // 履歴へ自動保存（同じstartedAtのエントリがあれば更新、なければ追加）
    const cum = computeCumulative(current.players, current.rounds);
    const ranked = computeRanked(current.players, cum.totals);
    const entry = {
      id: current.startedAt || new Date().toISOString(),
      startedAt: current.startedAt || new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      players: current.players,
      rounds: current.rounds,
      numPlayers: current.numPlayers,
      nameInputs: current.nameInputs,
      winner: ranked[0]?.name || "",
      winnerScore: ranked[0]?.score ?? 0,
    };
    setHistory((prev) => {
      const filtered = prev.filter((h) => h.id !== entry.id);
      return [entry, ...filtered];
    });
    updateCurrent({ phase: "result" });
  };

  const newGame = () => {
    if (current.rounds.length > 0 && current.phase !== "result") {
      if (!confirm("進行中のゲームを破棄して新しく始める？")) return;
    }
    setCurrent(emptyCurrent());
  };

  // 履歴操作
  const deleteHistory = (id) => {
    if (!confirm("この試合の記録を削除する？")) return;
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  // 履歴ゲームを再開（current に読み込んで play へ）
  const resumeGame = (id) => {
    const entry = history.find((h) => h.id === id);
    if (!entry) return;
    const proceed = () => {
      setCurrent({
        phase: "play",
        numPlayers: entry.numPlayers || entry.players.length,
        players: entry.players,
        rounds: entry.rounds,
        nameInputs:
          entry.nameInputs ||
          Array(12)
            .fill(0)
            .map((_, i) => entry.players[i] || `P${i + 1}`),
        startedAt: entry.startedAt, // 同じidを保ち、結果保存時に上書き更新
      });
      setView("main");
    };
    // 進行中の別ゲームがあれば警告
    if (
      current.rounds.length > 0 &&
      current.phase !== "result" &&
      current.startedAt !== entry.startedAt
    ) {
      if (!confirm("進行中のゲームを破棄してこの試合を再開する？")) return;
    }
    proceed();
  };

  // ===== ルーティング =====
  if (view === "main" && view !== null && typeof view === "object") {
    // never
  }

  if (typeof view === "object" && view.type === "history-list") {
    return (
      <HistoryListScreen
        history={history}
        onBack={() => setView("main")}
        onSelect={(id) => setView({ type: "history-detail", id })}
        onDelete={deleteHistory}
      />
    );
  }

  if (typeof view === "object" && view.type === "history-detail") {
    const entry = history.find((h) => h.id === view.id);
    if (!entry) {
      setView({ type: "history-list" });
      return null;
    }
    return (
      <HistoryDetailScreen
        entry={entry}
        onBack={() => setView({ type: "history-list" })}
        onResume={() => resumeGame(entry.id)}
      />
    );
  }

  // メインフロー
  if (current.phase === "setup") {
    return (
      <SetupScreen
        numPlayers={current.numPlayers}
        setNumPlayers={(n) => updateCurrent({ numPlayers: n })}
        nameInputs={current.nameInputs}
        setNameInputs={(ni) => updateCurrent({ nameInputs: ni })}
        startGame={startGame}
        historyCount={history.length}
        openHistory={() => setView({ type: "history-list" })}
      />
    );
  }

  if (current.phase === "result") {
    return (
      <ResultScreen
        players={current.players}
        rounds={current.rounds}
        onBackToPlay={() => updateCurrent({ phase: "play" })}
        onNewGame={newGame}
        openHistory={() => setView({ type: "history-list" })}
        historyCount={history.length}
      />
    );
  }

  return (
    <PlayScreen
      players={current.players}
      rounds={current.rounds}
      setRounds={(rounds) => updateCurrent({ rounds })}
      goResult={goResult}
      onNewGame={newGame}
    />
  );
}

// ============ Setup ============
function SetupScreen({
  numPlayers,
  setNumPlayers,
  nameInputs,
  setNameInputs,
  startGame,
  historyCount,
  openHistory,
}) {
  return (
    <Shell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={styles.h1}>YANIV</h1>
        {historyCount > 0 && (
          <button onClick={openHistory} style={styles.linkBtn}>
            履歴 ({historyCount}) →
          </button>
        )}
      </div>
      <p style={styles.sub}>得点計算機 / setup</p>

      <div style={styles.card}>
        <label style={styles.label}>人数</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
            <button
              key={n}
              onClick={() => setNumPlayers(n)}
              style={{
                ...styles.numBtn,
                ...(numPlayers === n ? styles.numBtnActive : {}),
              }}
            >
              {n}
            </button>
          ))}
        </div>

        <label style={{ ...styles.label, marginTop: 24 }}>プレイヤー名</label>
        <div style={{ display: "grid", gap: 8 }}>
          {Array.from({ length: numPlayers }).map((_, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 12 }}
            >
              <span
                style={{
                  width: 14,
                  height: 14,
                  background: PLAYER_COLORS[i],
                  borderRadius: 2,
                  flexShrink: 0,
                }}
              />
              <input
                value={nameInputs[i]}
                onChange={(e) => {
                  const next = [...nameInputs];
                  next[i] = e.target.value;
                  setNameInputs(next);
                }}
                style={styles.input}
                placeholder={`P${i + 1}`}
              />
            </div>
          ))}
        </div>

        <button onClick={startGame} style={styles.primary}>
          ゲーム開始 →
        </button>
      </div>
    </Shell>
  );
}

// ============ Play ============
function PlayScreen({ players, rounds, setRounds, goResult, onNewGame }) {
  const cumulative = useMemo(
    () => computeCumulative(players, rounds),
    [players, rounds]
  );
  const [draftTransfers, setDraftTransfers] = useState([
    { from: 0, to: 1, points: "" },
  ]);
  const [chartOpen, setChartOpen] = useState(true);

  const addTransfer = () => {
    setDraftTransfers([...draftTransfers, { from: 0, to: 1, points: "" }]);
  };
  const updateTransfer = (idx, key, val) => {
    const next = [...draftTransfers];
    next[idx] = { ...next[idx], [key]: val };
    setDraftTransfers(next);
  };
  const removeTransfer = (idx) => {
    if (draftTransfers.length === 1) return;
    setDraftTransfers(draftTransfers.filter((_, i) => i !== idx));
  };
  const commitRound = () => {
    const cleaned = draftTransfers
      .map((t) => ({
        from: Number(t.from),
        to: Number(t.to),
        points: Number(t.points),
      }))
      .filter(
        (t) => !Number.isNaN(t.points) && t.points !== 0 && t.from !== t.to
      );
    if (cleaned.length === 0) return;
    setRounds([...rounds, cleaned]);
    setDraftTransfers([{ from: 0, to: 1, points: "" }]);
  };
  const undoLastRound = () => {
    if (rounds.length === 0) return;
    setRounds(rounds.slice(0, -1));
  };

  return (
    <Shell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={styles.h1}>YANIV</h1>
        <button onClick={onNewGame} style={styles.linkBtn}>
          新規ゲーム
        </button>
      </div>
      <p style={styles.sub}>Round {rounds.length + 1}</p>

      <div style={styles.card}>
        <h2 style={styles.h2}>累計</h2>
        <div style={{ display: "grid", gap: 6 }}>
          {players.map((p, i) => (
            <div
              key={p}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    background: PLAYER_COLORS[i],
                    borderRadius: 2,
                  }}
                />
                {p}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 16 }}>
                {cumulative.totals[i]}
              </span>
            </div>
          ))}
        </div>
      </div>

      {rounds.length > 0 && (
        <div style={styles.card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: chartOpen ? 12 : 0,
            }}
          >
            <h2 style={{ ...styles.h2, margin: 0 }}>推移</h2>
            <button
              onClick={() => setChartOpen(!chartOpen)}
              style={styles.linkBtn}
            >
              {chartOpen ? "▼ 隠す" : "▶ 表示"}
            </button>
          </div>
          {chartOpen && (
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={cumulative.series}>
                  <CartesianGrid stroke="#eee" />
                  <XAxis dataKey="round" stroke="#666" fontSize={12} />
                  <YAxis stroke="#666" fontSize={12} width={30} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {players.map((p, i) => (
                    <Line
                      key={p}
                      type="monotone"
                      dataKey={p}
                      stroke={PLAYER_COLORS[i]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      isAnimationActive={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}

      <div style={styles.card}>
        <h2 style={styles.h2}>このラウンドの点の移動</h2>
        <div style={{ display: "grid", gap: 10 }}>
          {draftTransfers.map((t, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr auto auto",
                gap: 6,
                alignItems: "center",
              }}
            >
              <select
                value={t.from}
                onChange={(e) => updateTransfer(idx, "from", e.target.value)}
                style={styles.select}
              >
                {players.map((p, i) => (
                  <option key={i} value={i}>
                    {p}
                  </option>
                ))}
              </select>
              <span style={{ color: "#999", fontWeight: 700 }}>→</span>
              <select
                value={t.to}
                onChange={(e) => updateTransfer(idx, "to", e.target.value)}
                style={styles.select}
              >
                {players.map((p, i) => (
                  <option key={i} value={i}>
                    {p}
                  </option>
                ))}
              </select>
              <input
                type="number"
                inputMode="numeric"
                value={t.points}
                onChange={(e) => updateTransfer(idx, "points", e.target.value)}
                placeholder="点"
                style={{ ...styles.input, width: 70, textAlign: "right" }}
              />
              <button
                onClick={() => removeTransfer(idx)}
                style={styles.iconBtn}
                disabled={draftTransfers.length === 1}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addTransfer}
          style={{ ...styles.secondary, marginTop: 12 }}
        >
          + 行を追加
        </button>
        <button onClick={commitRound} style={styles.primary}>
          ラウンド確定
        </button>
      </div>

      {rounds.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>履歴 ({rounds.length} R)</h2>
          <div
            style={{
              display: "grid",
              gap: 8,
              maxHeight: 200,
              overflowY: "auto",
            }}
          >
            {rounds.map((round, rIdx) => (
              <div
                key={rIdx}
                style={{
                  padding: "8px 10px",
                  background: "#f7f7f5",
                  borderRadius: 4,
                  fontSize: 13,
                }}
              >
                <strong>R{rIdx + 1}:</strong>{" "}
                {round
                  .map((t) => `${players[t.from]}→${players[t.to]} ${t.points}`)
                  .join(" / ")}
              </div>
            ))}
          </div>
          <button
            onClick={undoLastRound}
            style={{ ...styles.secondary, marginTop: 8 }}
          >
            ← 最終ラウンドを取り消し
          </button>
        </div>
      )}

      <button
        onClick={goResult}
        style={styles.primary}
        disabled={rounds.length === 0}
      >
        結果を見る →
      </button>
    </Shell>
  );
}

// ============ Result（汎用：現在ゲームでも履歴詳細でも使う） ============
function ResultView({ players, rounds, mode = "current", onBackToPlay, onNewGame, onBack, onResume }) {
  const cumulative = useMemo(
    () => computeCumulative(players, rounds),
    [players, rounds]
  );
  const ranked = useMemo(
    () => computeRanked(players, cumulative.totals),
    [players, cumulative.totals]
  );
  const settlement = useMemo(
    () => computeSettlement(players, cumulative.totals),
    [players, cumulative.totals]
  );

  const shareRef = useRef(null);
  const [replayIdx, setReplayIdx] = useState(cumulative.series.length - 1);
  const [isReplaying, setIsReplaying] = useState(false);
  const replayTimerRef = useRef(null);

  const startReplay = () => {
    if (isReplaying) {
      clearInterval(replayTimerRef.current);
      setIsReplaying(false);
      return;
    }
    setIsReplaying(true);
    setReplayIdx(0);
    let i = 0;
    replayTimerRef.current = setInterval(() => {
      i++;
      if (i >= cumulative.series.length) {
        clearInterval(replayTimerRef.current);
        setIsReplaying(false);
        setReplayIdx(cumulative.series.length - 1);
      } else {
        setReplayIdx(i);
      }
    }, 700);
  };

  useEffect(() => () => clearInterval(replayTimerRef.current), []);

  const visibleSeries = cumulative.series.slice(0, replayIdx + 1);
  const allValues = cumulative.series.flatMap((s) => players.map((p) => s[p]));
  const yMin = Math.min(0, ...allValues);
  const yMax = Math.max(0, ...allValues);

  const saveScreenshot = async () => {
    if (!shareRef.current) return;
    try {
      const dataUrl = await toPng(shareRef.current, {
        backgroundColor: "#f4f1ea",
        pixelRatio: 2,
      });
      const link = document.createElement("a");
      link.download = `yaniv-result-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      alert("保存に失敗。ブラウザの設定を確認してください。");
    }
  };

  return (
    <>
      <div ref={shareRef} style={{ display: "grid", gap: 16 }}>
        <div style={styles.card}>
          <h2 style={styles.h2}>最終順位</h2>
          <ol style={{ paddingLeft: 0, listStyle: "none", margin: 0 }}>
            {ranked.map((r, i) => (
              <li
                key={r.idx}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 0",
                  borderBottom:
                    i === ranked.length - 1 ? "none" : "1px solid #eee",
                }}
              >
                <span
                  style={{ display: "flex", alignItems: "center", gap: 12 }}
                >
                  <span
                    style={{
                      ...styles.rank,
                      background: i === 0 ? "#1D3557" : "#fff",
                      color: i === 0 ? "#fff" : "#1D3557",
                      border: "1px solid #1D3557",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span
                    style={{
                      width: 10,
                      height: 10,
                      background: PLAYER_COLORS[r.idx],
                      borderRadius: 2,
                    }}
                  />
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 18 }}>
                  {r.score}
                </span>
              </li>
            ))}
          </ol>
        </div>

        <div style={styles.card}>
          <h2 style={styles.h2}>精算 — 全員を0にする</h2>
          {settlement.length === 0 ? (
            <p style={{ color: "#999", fontSize: 14, margin: 0 }}>
              全員すでに0点。精算は不要です。
            </p>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              {settlement.map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "10px 12px",
                    background: "#f7f7f5",
                    borderRadius: 6,
                    fontSize: 15,
                  }}
                >
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        background: PLAYER_COLORS[s.from],
                        borderRadius: 2,
                      }}
                    />
                    <strong>{players[s.from]}</strong>
                  </span>
                  <span style={{ color: "#999" }}>→</span>
                  <span
                    style={{ display: "flex", alignItems: "center", gap: 6 }}
                  >
                    <span
                      style={{
                        width: 9,
                        height: 9,
                        background: PLAYER_COLORS[s.to],
                        borderRadius: 2,
                      }}
                    />
                    <strong>{players[s.to]}</strong>
                  </span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontFamily: "monospace",
                      fontSize: 16,
                      fontWeight: 700,
                    }}
                  >
                    {s.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p
            style={{
              fontSize: 11,
              color: "#aaa",
              margin: "10px 0 0",
            }}
          >
            マイナス（負債）の人がプラスの人に支払う形式
          </p>
        </div>

        <div style={styles.card}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <h2 style={{ ...styles.h2, margin: 0 }}>累計点の推移</h2>
            <span
              style={{
                fontSize: 12,
                color: "#999",
                fontFamily: "monospace",
              }}
            >
              R{replayIdx} / {cumulative.series.length - 1}
            </span>
          </div>
          <div style={{ width: "100%", height: 280 }}>
            <ResponsiveContainer>
              <LineChart data={visibleSeries}>
                <CartesianGrid stroke="#eee" />
                <XAxis
                  dataKey="round"
                  stroke="#666"
                  type="number"
                  domain={[0, cumulative.series.length - 1]}
                  ticks={cumulative.series.map((s) => s.round)}
                />
                <YAxis stroke="#666" domain={[yMin, yMax]} />
                <Tooltip />
                <Legend />
                {players.map((p, i) => (
                  <Line
                    key={p}
                    type="monotone"
                    dataKey={p}
                    stroke={PLAYER_COLORS[i]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <button onClick={startReplay} style={styles.secondary}>
          {isReplaying ? "■ 停止" : "▶ リプレイ再生"}
        </button>
        <input
          type="range"
          min="0"
          max={cumulative.series.length - 1}
          value={replayIdx}
          onChange={(e) => {
            if (isReplaying) {
              clearInterval(replayTimerRef.current);
              setIsReplaying(false);
            }
            setReplayIdx(Number(e.target.value));
          }}
          style={{ width: "100%" }}
        />
        <p
          style={{
            fontSize: 11,
            color: "#999",
            margin: "4px 0 8px",
            textAlign: "center",
          }}
        >
          スライダーで任意の時点に / 画面録画はiPhoneのコントロールセンターから
        </p>

        <button onClick={saveScreenshot} style={styles.primary}>
          📸 結果を画像で保存
        </button>
        {mode === "current" && (
          <>
            <button onClick={onBackToPlay} style={styles.secondary}>
              ← 試合に戻る（続行）
            </button>
            <button onClick={onNewGame} style={styles.danger}>
              新規ゲームを始める
            </button>
          </>
        )}
        {mode === "history" && (
          <>
            <button onClick={onResume} style={styles.primary}>
              ▶ この試合を再開する
            </button>
            <button onClick={onBack} style={styles.secondary}>
              ← 履歴一覧に戻る
            </button>
          </>
        )}
      </div>
    </>
  );
}

// ============ Result Screen（現在ゲーム） ============
function ResultScreen({ players, rounds, onBackToPlay, onNewGame, openHistory, historyCount }) {
  return (
    <Shell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={styles.h1}>RESULT</h1>
        {historyCount > 0 && (
          <button onClick={openHistory} style={styles.linkBtn}>
            履歴 ({historyCount}) →
          </button>
        )}
      </div>
      <p style={styles.sub}>
        {rounds.length} rounds / {players.length} players · 履歴に保存済み
      </p>
      <ResultView
        players={players}
        rounds={rounds}
        mode="current"
        onBackToPlay={onBackToPlay}
        onNewGame={onNewGame}
      />
    </Shell>
  );
}

// ============ 履歴一覧 ============
function HistoryListScreen({ history, onBack, onSelect, onDelete }) {
  return (
    <Shell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={styles.h1}>HISTORY</h1>
        <button onClick={onBack} style={styles.linkBtn}>
          ← 戻る
        </button>
      </div>
      <p style={styles.sub}>{history.length} games</p>

      {history.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", color: "#999" }}>
          まだ記録がありません
        </div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {history.map((h) => {
            const d = new Date(h.finishedAt || h.startedAt);
            const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
            return (
              <div key={h.id} style={styles.card}>
                <div
                  onClick={() => onSelect(h.id)}
                  style={{ cursor: "pointer" }}
                >
                  <div
                    style={{
                      fontSize: 11,
                      color: "#999",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {dateStr}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "baseline",
                      marginTop: 6,
                    }}
                  >
                    <div>
                      <span
                        style={{ fontSize: 18, fontWeight: 700 }}
                      >
                        🏆 {h.winner}
                      </span>
                      <span
                        style={{
                          fontSize: 13,
                          color: "#666",
                          marginLeft: 8,
                          fontFamily: "monospace",
                        }}
                      >
                        {h.winnerScore}
                      </span>
                    </div>
                    <span style={{ fontSize: 12, color: "#999" }}>
                      {h.players.length}人 / {h.rounds.length}R →
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      color: "#666",
                      marginTop: 6,
                    }}
                  >
                    {h.players.join(" · ")}
                  </div>
                </div>
                <button
                  onClick={() => onDelete(h.id)}
                  style={{
                    ...styles.linkBtn,
                    color: "#c0392b",
                    marginTop: 10,
                    fontSize: 11,
                  }}
                >
                  削除
                </button>
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

// ============ 履歴詳細 ============
function HistoryDetailScreen({ entry, onBack, onResume }) {
  const d = new Date(entry.finishedAt || entry.startedAt);
  const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return (
    <Shell>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={styles.h1}>RESULT</h1>
        <button onClick={onBack} style={styles.linkBtn}>
          ← 履歴
        </button>
      </div>
      <p style={styles.sub}>
        {dateStr} · {entry.rounds.length} rounds / {entry.players.length} players
      </p>
      <ResultView
        players={entry.players}
        rounds={entry.rounds}
        mode="history"
        onBack={onBack}
        onResume={onResume}
      />
    </Shell>
  );
}

// ============ Shell & styles ============
function Shell({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        padding: "max(24px, env(safe-area-inset-top)) 16px 32px",
      }}
    >
      <div
        style={{
          maxWidth: 520,
          margin: "0 auto",
          display: "grid",
          gap: 16,
        }}
      >
        {children}
      </div>
    </div>
  );
}

const styles = {
  h1: {
    fontSize: 36,
    fontWeight: 900,
    letterSpacing: "-0.02em",
    margin: 0,
  },
  h2: {
    fontSize: 14,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#666",
    margin: "0 0 12px",
  },
  sub: {
    fontSize: 13,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    marginTop: 4,
  },
  card: {
    background: "#fff",
    borderRadius: 8,
    padding: 20,
    border: "1px solid #e5e2da",
  },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#666",
    marginBottom: 10,
  },
  input: {
    flex: 1,
    padding: "10px 12px",
    fontSize: 15,
    border: "1px solid #d4d0c4",
    borderRadius: 4,
    background: "#fafaf7",
    outline: "none",
  },
  select: {
    padding: "10px 8px",
    fontSize: 14,
    border: "1px solid #d4d0c4",
    borderRadius: 4,
    background: "#fafaf7",
    outline: "none",
  },
  numBtn: {
    width: 44,
    height: 44,
    border: "1px solid #d4d0c4",
    borderRadius: 4,
    background: "#fff",
    fontSize: 16,
    fontWeight: 600,
  },
  numBtnActive: {
    background: "#1a1a1a",
    color: "#fff",
    borderColor: "#1a1a1a",
  },
  primary: {
    width: "100%",
    marginTop: 16,
    padding: "14px",
    background: "#1a1a1a",
    color: "#fff",
    border: "none",
    borderRadius: 4,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "0.05em",
  },
  secondary: {
    width: "100%",
    padding: "10px",
    background: "#fff",
    color: "#1a1a1a",
    border: "1px solid #1a1a1a",
    borderRadius: 4,
    fontSize: 13,
    fontWeight: 600,
  },
  danger: {
    width: "100%",
    padding: "10px",
    background: "#fff",
    color: "#c0392b",
    border: "1px solid #c0392b",
    borderRadius: 4,
    fontSize: 13,
    fontWeight: 600,
  },
  iconBtn: {
    width: 32,
    height: 32,
    border: "1px solid #d4d0c4",
    background: "#fff",
    borderRadius: 4,
    fontSize: 16,
    color: "#999",
  },
  linkBtn: {
    background: "none",
    border: "none",
    color: "#666",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
    padding: 0,
  },
  rank: {
    width: 28,
    height: 28,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "50%",
    fontWeight: 700,
    fontSize: 13,
  },
};
