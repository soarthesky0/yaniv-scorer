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
import {
  DEFAULT_SETTINGS,
  ROUND_TYPE_LABEL,
  computeRound,
  normalizeRounds,
  currentPot,
  computeCumulative,
  computeRanked,
  computeSettlement,
  activeDouble,
  nextDoubleRound,
  computeStats,
  describeRound,
  buildCsv,
} from "./logic.js";

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
const POT_COLOR = "#8a8577";
const MAX_PLAYERS = 12;
const STORAGE_KEY = "yaniv-scorer-v2";

const defaultNames = () =>
  Array(MAX_PLAYERS)
    .fill(0)
    .map((_, i) => `P${i + 1}`);

const emptyCurrent = (settings) => ({
  phase: "setup", // setup | play | result
  numPlayers: 4,
  players: [],
  rounds: [],
  nameInputs: defaultNames(),
  startedAt: null,
  settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
  doubleLog: {},
});

function normalizeGame(g) {
  const players = g.players || [];
  return {
    ...g,
    rounds: normalizeRounds(g.rounds, players.length),
    settings: { ...DEFAULT_SETTINGS, ...(g.settings || {}) },
    doubleLog: g.doubleLog || {},
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { current: emptyCurrent(), history: [], lastSettings: DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    const lastSettings = { ...DEFAULT_SETTINGS, ...(parsed.lastSettings || {}) };
    const cur = { ...emptyCurrent(lastSettings), ...(parsed.current || {}) };
    if (!cur.nameInputs || cur.nameInputs.length < MAX_PLAYERS) {
      cur.nameInputs = [...(cur.nameInputs || []), ...defaultNames()].slice(0, MAX_PLAYERS);
    }
    return {
      current: normalizeGame(cur),
      history: Array.isArray(parsed.history) ? parsed.history.map(normalizeGame) : [],
      lastSettings,
    };
  } catch {
    return { current: emptyCurrent(), history: [], lastSettings: DEFAULT_SETTINGS };
  }
}

function formatDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(
    d.getMinutes()
  ).padStart(2, "0")}`;
}

export default function App() {
  const [initial] = useState(loadStore);
  const [current, setCurrent] = useState(initial.current);
  const [history, setHistory] = useState(initial.history);
  const [lastSettings, setLastSettings] = useState(initial.lastSettings);
  const [view, setView] = useState({ type: "main" });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ current, history, lastSettings }));
    } catch {}
  }, [current, history, lastSettings]);

  const updateCurrent = useCallback((patch) => {
    setCurrent((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
  }, []);

  const updateSettings = (patch) => {
    const next = { ...current.settings, ...patch };
    updateCurrent({ settings: next });
    setLastSettings(next);
  };

  const startGame = () => {
    const names = current.nameInputs.slice(0, current.numPlayers).map((n, i) => n.trim() || `P${i + 1}`);
    updateCurrent({
      players: names,
      rounds: [],
      doubleLog: {},
      phase: "play",
      startedAt: new Date().toISOString(),
    });
  };

  const goResult = () => {
    if (current.rounds.length === 0) return;
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
      settings: current.settings,
      doubleLog: current.doubleLog,
      winner: ranked[0]?.name || "",
      winnerScore: ranked[0]?.score ?? 0,
    };
    setHistory((prev) => [entry, ...prev.filter((h) => h.id !== entry.id)]);
    updateCurrent({ phase: "result" });
  };

  const newGame = () => {
    if (current.rounds.length > 0 && current.phase !== "result") {
      if (!confirm("進行中のゲームを破棄して新しく始める？")) return;
    }
    setCurrent({
      ...emptyCurrent(lastSettings),
      numPlayers: current.numPlayers,
      nameInputs: current.nameInputs,
    });
  };

  const deleteHistory = (id) => {
    if (!confirm("この試合の記録を削除する？")) return;
    setHistory((prev) => prev.filter((h) => h.id !== id));
  };

  const resumeGame = (id) => {
    const entry = history.find((h) => h.id === id);
    if (!entry) return;
    if (current.rounds.length > 0 && current.phase !== "result" && current.startedAt !== entry.startedAt) {
      if (!confirm("進行中のゲームを破棄してこの試合を再開する？")) return;
    }
    setCurrent({
      phase: "play",
      numPlayers: entry.numPlayers || entry.players.length,
      players: entry.players,
      rounds: entry.rounds,
      nameInputs: entry.nameInputs || defaultNames().map((n, i) => entry.players[i] || n),
      startedAt: entry.startedAt,
      settings: { ...DEFAULT_SETTINGS, ...(entry.settings || {}) },
      doubleLog: entry.doubleLog || {},
    });
    setView({ type: "main" });
  };

  if (view.type === "history-list" || (view.type === "history-detail" && !history.find((h) => h.id === view.id))) {
    return (
      <HistoryListScreen
        history={history}
        onBack={() => setView({ type: "main" })}
        onSelect={(id) => setView({ type: "history-detail", id })}
        onDelete={deleteHistory}
      />
    );
  }

  if (view.type === "history-detail") {
    const entry = history.find((h) => h.id === view.id);
    return (
      <HistoryDetailScreen
        entry={entry}
        onBack={() => setView({ type: "history-list" })}
        onResume={() => resumeGame(entry.id)}
      />
    );
  }

  if (current.phase === "setup") {
    return (
      <SetupScreen
        current={current}
        updateCurrent={updateCurrent}
        updateSettings={updateSettings}
        startGame={startGame}
        historyCount={history.length}
        openHistory={() => setView({ type: "history-list" })}
      />
    );
  }

  if (current.phase === "result") {
    return (
      <ResultScreen
        game={current}
        onBackToPlay={() => updateCurrent({ phase: "play" })}
        onNewGame={newGame}
        openHistory={() => setView({ type: "history-list" })}
        historyCount={history.length}
      />
    );
  }

  return (
    <PlayScreen
      game={current}
      updateCurrent={updateCurrent}
      updateSettings={updateSettings}
      goResult={goResult}
      onNewGame={newGame}
    />
  );
}

// ============ 共通パーツ ============
function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", padding: "max(20px, env(safe-area-inset-top)) 16px 40px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "grid", gap: 14 }}>{children}</div>
    </div>
  );
}

function Header({ title, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <h1 style={styles.h1}>{title}</h1>
      <div style={{ display: "flex", gap: 16 }}>{right}</div>
    </div>
  );
}

function Dot({ idx, size = 10 }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        background: PLAYER_COLORS[idx % PLAYER_COLORS.length],
        borderRadius: 2,
        flexShrink: 0,
        display: "inline-block",
      }}
    />
  );
}

function Segmented({ options, value, onChange, small }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          onClick={() => onChange(o.value)}
          style={{
            ...styles.chip,
            ...(small ? { padding: "6px 10px", fontSize: 13 } : {}),
            ...(value === o.value ? styles.chipActive : {}),
            ...(o.activeColor && value === o.value ? { background: o.activeColor, borderColor: o.activeColor } : {}),
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ label, value, onChange, note }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{label}</div>
        {note && <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{note}</div>}
      </div>
      <button
        onClick={() => onChange(!value)}
        aria-pressed={value}
        style={{
          width: 50,
          height: 30,
          borderRadius: 15,
          border: "none",
          background: value ? "#1a1a1a" : "#d4d0c4",
          position: "relative",
          flexShrink: 0,
          transition: "background 0.15s",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 3,
            left: value ? 23 : 3,
            width: 24,
            height: 24,
            borderRadius: 12,
            background: "#fff",
            transition: "left 0.15s",
          }}
        />
      </button>
    </div>
  );
}

function PlayerChips({ players, selected, onToggle, disabled = [] }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {players.map((p, i) => {
        const on = selected.includes(i);
        const off = disabled.includes(i);
        return (
          <button
            key={i}
            disabled={off}
            onClick={() => onToggle(i)}
            style={{
              ...styles.chip,
              display: "flex",
              alignItems: "center",
              gap: 6,
              opacity: off ? 0.3 : 1,
              ...(on ? styles.chipActive : {}),
            }}
          >
            <Dot idx={i} size={9} />
            {p}
          </button>
        );
      })}
    </div>
  );
}

function NumInput({ value, onChange, placeholder = "手札", width = 76, autoFocus }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      pattern="[0-9]*"
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{ ...styles.input, flex: "none", width, textAlign: "right", fontSize: 17 }}
    />
  );
}

// ============ 設定 ============
function SettingsFields({ settings, onChange, inGame }) {
  const s = settings;
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <label style={styles.label}>倍マッチの周期</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            style={styles.stepBtn}
            onClick={() => onChange({ doublePeriod: Math.max(0, (s.doublePeriod || 0) - 1) })}
          >
            −
          </button>
          <span style={{ fontSize: 18, fontWeight: 700, minWidth: 110, textAlign: "center" }}>
            {s.doublePeriod > 0 ? `${s.doublePeriod}ラウンドごと` : "オフ"}
          </span>
          <button style={styles.stepBtn} onClick={() => onChange({ doublePeriod: (s.doublePeriod || 0) + 1 })}>
            ＋
          </button>
        </div>
        {inGame && (
          <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>
            変更するとこの先の予定ラウンドが新しい周期で計算されます
          </div>
        )}
      </div>

      <div style={{ borderTop: "1px solid #eee", paddingTop: 16, display: "grid", gap: 14 }}>
        <Toggle
          label="流局ポット"
          value={s.potEnabled}
          onChange={(v) => onChange({ potEnabled: v })}
          note="山札が尽きたら流局、手札合計をポットへ"
        />
        {s.potEnabled && (
          <>
            <div>
              <label style={styles.label}>ポットへの支払い倍率</label>
              <Segmented
                small
                value={s.potRate}
                onChange={(v) => onChange({ potRate: v })}
                options={[
                  { value: 1, label: "×1" },
                  { value: 2, label: "×2" },
                  { value: 3, label: "×3" },
                ]}
              />
            </div>
            <Toggle
              label="倍マッチの流局で支払いにも倍率"
              value={s.multiplyPotIn}
              onChange={(v) => onChange({ multiplyPotIn: v })}
            />
            <Toggle
              label="倍マッチのポット獲得にも倍率"
              value={s.multiplyPotOut}
              onChange={(v) => onChange({ multiplyPotOut: v })}
            />
            <div>
              <label style={styles.label}>山分けの端数</label>
              <Segmented
                small
                value={s.splitRemainder}
                onChange={(v) => onChange({ splitRemainder: v })}
                options={[
                  { value: "carry", label: "切り捨て（ポットに残す）" },
                  { value: "distribute", label: "1点ずつ配る" },
                ]}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SettingsSheet({ settings, onChange, onClose }) {
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
          padding: "20px 20px max(24px, env(safe-area-inset-bottom))",
          maxHeight: "85vh",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ ...styles.h2, margin: 0 }}>設定</h2>
          <button onClick={onClose} style={styles.linkBtn}>
            閉じる
          </button>
        </div>
        <SettingsFields settings={settings} onChange={onChange} inGame />
      </div>
    </div>
  );
}

// ============ Setup ============
function SetupScreen({ current, updateCurrent, updateSettings, startGame, historyCount, openHistory }) {
  const { numPlayers, nameInputs } = current;
  return (
    <Shell>
      <Header
        title="YANIV"
        right={
          historyCount > 0 && (
            <button onClick={openHistory} style={styles.linkBtn}>
              履歴 ({historyCount}) →
            </button>
          )
        }
      />
      <p style={styles.sub}>得点計算機 / setup</p>

      <div style={styles.card}>
        <label style={styles.label}>人数</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2).map((n) => (
            <button
              key={n}
              onClick={() => updateCurrent({ numPlayers: n })}
              style={{ ...styles.numBtn, ...(numPlayers === n ? styles.numBtnActive : {}) }}
            >
              {n}
            </button>
          ))}
        </div>

        <label style={{ ...styles.label, marginTop: 24 }}>プレイヤー名</label>
        <div style={{ display: "grid", gap: 8 }}>
          {Array.from({ length: numPlayers }).map((_, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <Dot idx={i} size={14} />
              <input
                value={nameInputs[i]}
                onChange={(e) => {
                  const next = [...nameInputs];
                  next[i] = e.target.value;
                  updateCurrent({ nameInputs: next });
                }}
                style={styles.input}
                placeholder={`P${i + 1}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>ルール設定</h2>
        <SettingsFields settings={current.settings} onChange={updateSettings} />
      </div>

      <button onClick={startGame} style={styles.primary}>
        ゲーム開始 →
      </button>
    </Shell>
  );
}

// ============ Play ============
const emptyInput = (n) => ({
  type: null,
  multiplier: 1,
  declarer: null,
  declarerHand: "",
  targets: [],
  targetHand: "",
  hands: Array(n).fill(""),
  manualTransfers: [{ from: 0, to: 1, points: "" }],
});

function PlayScreen({ game, updateCurrent, updateSettings, goResult, onNewGame }) {
  const { players, rounds, settings, doubleLog } = game;
  const roundNo = rounds.length + 1;
  const pot = currentPot(rounds);
  const cumulative = useMemo(() => computeCumulative(players, rounds), [players, rounds]);
  const [input, setInput] = useState(() => emptyInput(players.length));
  const [chartOpen, setChartOpen] = useState(true);
  const [statsOpen, setStatsOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const double = activeDouble(roundNo, settings.doublePeriod, doubleLog);
  const nextDouble = nextDoubleRound(roundNo, settings.doublePeriod, doubleLog);

  const announce = () =>
    updateCurrent((prev) => ({
      doubleLog: { ...prev.doubleLog, [double.scheduled]: { targetRound: roundNo, announced: true } },
    }));
  const postpone = () =>
    updateCurrent((prev) => ({
      doubleLog: { ...prev.doubleLog, [double.scheduled]: { targetRound: roundNo + 1, announced: false } },
    }));

  const result = input.type ? computeRound(input, players.length, pot, settings) : null;

  const commit = () => {
    if (!result || result.error) return;
    const record = {
      type: input.type,
      multiplier: input.type === "manual" ? 1 : input.multiplier,
      ...(input.type === "success" || input.type === "back"
        ? {
            declarer: input.declarer,
            declarerHand: Number(input.declarerHand),
            targets: input.targets,
            targetHand: Number(input.targetHand),
          }
        : {}),
      ...(input.type === "draw" ? { hands: input.hands.map(Number) } : {}),
      transfers: result.transfers,
      potIn: result.potIn,
      potOut: result.potOut,
      deltas: result.deltas,
      potBefore: pot,
      potAfter: result.potAfter,
      doubleLogBefore: doubleLog,
      at: new Date().toISOString(),
    };
    // アナウンスされないまま終わった倍マッチは次のラウンドへずらす
    let nextLog = doubleLog;
    if (double && !double.announced) {
      nextLog = { ...doubleLog, [double.scheduled]: { targetRound: roundNo + 1, announced: false } };
    }
    updateCurrent({ rounds: [...rounds, record], doubleLog: nextLog });
    setInput(emptyInput(players.length));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const undoLastRound = () => {
    if (rounds.length === 0) return;
    if (!confirm(`ラウンド${rounds.length}を取り消す？`)) return;
    const last = rounds[rounds.length - 1];
    updateCurrent({
      rounds: rounds.slice(0, -1),
      ...(last.doubleLogBefore ? { doubleLog: last.doubleLogBefore } : {}),
    });
  };

  return (
    <Shell>
      <Header
        title="YANIV"
        right={
          <>
            <button onClick={() => setSettingsOpen(true)} style={styles.linkBtn}>
              設定
            </button>
            <button onClick={onNewGame} style={styles.linkBtn}>
              新規ゲーム
            </button>
          </>
        }
      />

      {/* ラウンド数・ポット */}
      <div style={{ ...styles.card, display: "flex", alignItems: "stretch", padding: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, padding: "14px 18px" }}>
          <div style={styles.miniLabel}>ROUND</div>
          <div style={styles.bigNum}>{roundNo}</div>
          {nextDouble && (
            <div style={{ fontSize: 11, color: "#999" }}>
              次の倍マッチ：{nextDouble === roundNo ? "このラウンド" : `R${nextDouble}`}
            </div>
          )}
        </div>
        {settings.potEnabled && (
          <div
            style={{
              flex: 1,
              padding: "14px 18px",
              background: pot > 0 ? "#1a1a1a" : "#f7f5ef",
              color: pot > 0 ? "#f4f1ea" : "#1a1a1a",
              borderLeft: "1px solid #e5e2da",
            }}
          >
            <div style={{ ...styles.miniLabel, color: pot > 0 ? "#b9b4a6" : "#888" }}>POT</div>
            <div style={styles.bigNum}>{pot}</div>
            <div style={{ fontSize: 11, opacity: 0.6 }}>流局ポット ON</div>
          </div>
        )}
      </div>

      {/* 倍マッチ通知 */}
      {double && !double.announced && (
        <div style={styles.doubleAlert}>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "0.02em" }}>倍マッチのラウンド！</div>
          <div style={{ fontSize: 13, opacity: 0.9, marginTop: 4 }}>
            {double.scheduled === roundNo
              ? `R${double.scheduled}は倍マッチの予定です`
              : `R${double.scheduled}の倍マッチをずらしたラウンドです`}
            。アナウンスしましたか？
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
            <button onClick={announce} style={styles.alertBtnPrimary}>
              アナウンスした
            </button>
            <button onClick={postpone} style={styles.alertBtn}>
              次のラウンドにずらす
            </button>
          </div>
        </div>
      )}
      {double && double.announced && (
        <div style={{ ...styles.card, borderColor: "#E63946", background: "#fff5f5", padding: "12px 16px" }}>
          <strong style={{ color: "#E63946" }}>倍マッチ中</strong>
          <span style={{ fontSize: 13, color: "#666" }}>　入力時に倍率（×2／×3）を選んでください</span>
        </div>
      )}

      {/* 累計 */}
      <div style={styles.card}>
        <h2 style={styles.h2}>累計</h2>
        <div style={{ display: "grid", gap: 6 }}>
          {players.map((p, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Dot idx={i} />
                {p}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 16 }}>{cumulative.totals[i]}</span>
            </div>
          ))}
        </div>
      </div>

      {rounds.length > 0 && (
        <Collapsible title="推移" open={chartOpen} setOpen={setChartOpen}>
          <ScoreChart players={players} data={cumulative.series} showPot={settings.potEnabled} height={240} />
        </Collapsible>
      )}

      {/* 入力 */}
      <RoundInput
        players={players}
        input={input}
        setInput={setInput}
        result={result}
        pot={pot}
        settings={settings}
        double={double}
        onCommit={commit}
      />

      {rounds.length > 0 && (
        <div style={styles.card}>
          <h2 style={styles.h2}>ラウンド記録 ({rounds.length})</h2>
          <RoundLog rounds={rounds} players={players} />
          <button onClick={undoLastRound} style={{ ...styles.secondary, marginTop: 10 }}>
            ← 最終ラウンドを取り消し
          </button>
        </div>
      )}

      {rounds.length > 0 && (
        <Collapsible title="統計" open={statsOpen} setOpen={setStatsOpen}>
          <StatsView players={players} rounds={rounds} potEnabled={settings.potEnabled} />
        </Collapsible>
      )}

      <button onClick={goResult} style={styles.primary} disabled={rounds.length === 0}>
        結果を見る →
      </button>

      {settingsOpen && (
        <SettingsSheet settings={settings} onChange={updateSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </Shell>
  );
}

function Collapsible({ title, open, setOpen, children }) {
  return (
    <div style={styles.card}>
      <div
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: open ? 12 : 0 }}
      >
        <h2 style={{ ...styles.h2, margin: 0 }}>{title}</h2>
        <button onClick={() => setOpen(!open)} style={styles.linkBtn}>
          {open ? "▼ 隠す" : "▶ 表示"}
        </button>
      </div>
      {open && children}
    </div>
  );
}

function RoundInput({ players, input, setInput, result, pot, settings, double, onCommit }) {
  const set = (patch) => setInput((prev) => ({ ...prev, ...patch }));
  const n = players.length;
  const typeOptions = [
    { value: "success", label: "ヤニブ成功" },
    { value: "back", label: "ヤニブ返し" },
    ...(settings.potEnabled ? [{ value: "draw", label: "流局" }] : []),
    { value: "manual", label: "手入力" },
  ];
  const isDeclare = input.type === "success" || input.type === "back";

  const selectType = (t) => {
    // 種類を変えたときは選択内容を保ったまま切り替え（倍率は維持）
    set({ type: t, targets: input.targets.filter((x) => x !== input.declarer) });
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>結果の入力</h2>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${typeOptions.length}, 1fr)`, gap: 6 }}>
        {typeOptions.map((o) => (
          <button
            key={o.value}
            onClick={() => selectType(o.value)}
            style={{
              ...styles.typeBtn,
              ...(input.type === o.value ? styles.typeBtnActive : {}),
              ...(o.value === "manual" ? { fontSize: 12, fontWeight: 600 } : {}),
            }}
          >
            {o.label}
          </button>
        ))}
      </div>

      {input.type && input.type !== "manual" && (
        <div style={{ marginTop: 16 }}>
          <label style={styles.label}>倍率</label>
          <Segmented
            value={input.multiplier}
            onChange={(v) => set({ multiplier: v })}
            options={[
              { value: 1, label: "×1" },
              { value: 2, label: "×2", activeColor: "#E63946" },
              { value: 3, label: "×3", activeColor: "#E63946" },
            ]}
          />
          {double && double.announced && input.multiplier === 1 && (
            <div style={{ fontSize: 12, color: "#E63946", marginTop: 6 }}>倍マッチ中です。倍率を確認してください</div>
          )}
        </div>
      )}

      {isDeclare && (
        <>
          <div style={{ marginTop: 18 }}>
            <label style={styles.label}>宣言者</label>
            <PlayerChips
              players={players}
              selected={input.declarer === null ? [] : [input.declarer]}
              onToggle={(i) =>
                set({
                  declarer: input.declarer === i ? null : i,
                  targets: input.targets.filter((t) => t !== i),
                })
              }
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 13, color: "#666" }}>宣言者の手札合計</span>
              <NumInput value={input.declarerHand} onChange={(v) => set({ declarerHand: v })} />
            </div>
          </div>

          <div style={{ marginTop: 18 }}>
            <label style={styles.label}>
              {input.type === "success" ? "最高点の人（同点なら複数）" : "最低点の人（同点なら複数）"}
            </label>
            <PlayerChips
              players={players}
              selected={input.targets}
              disabled={input.declarer === null ? [] : [input.declarer]}
              onToggle={(i) =>
                set({
                  targets: input.targets.includes(i)
                    ? input.targets.filter((t) => t !== i)
                    : [...input.targets, i],
                })
              }
            />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
              <span style={{ fontSize: 13, color: "#666" }}>
                {input.type === "success" ? "最高点の手札合計" : "最低点の手札合計"}
              </span>
              <NumInput value={input.targetHand} onChange={(v) => set({ targetHand: v })} />
            </div>
          </div>
        </>
      )}

      {input.type === "draw" && (
        <div style={{ marginTop: 18 }}>
          <label style={styles.label}>全員の手札合計</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {players.map((p, i) => (
              <div
                key={i}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6 }}
              >
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 14,
                    overflow: "hidden",
                    whiteSpace: "nowrap",
                    textOverflow: "ellipsis",
                  }}
                >
                  <Dot idx={i} size={9} />
                  {p}
                </span>
                <NumInput
                  width={64}
                  value={input.hands[i]}
                  onChange={(v) => {
                    const hands = [...input.hands];
                    hands[i] = v;
                    set({ hands });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {input.type === "manual" && (
        <div style={{ marginTop: 18 }}>
          <label style={styles.label}>誰→誰に何点（例外処理用）</label>
          <div style={{ display: "grid", gap: 10 }}>
            {input.manualTransfers.map((t, idx) => (
              <div
                key={idx}
                style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto auto", gap: 6, alignItems: "center" }}
              >
                <select
                  value={t.from}
                  onChange={(e) => {
                    const m = [...input.manualTransfers];
                    m[idx] = { ...m[idx], from: e.target.value };
                    set({ manualTransfers: m });
                  }}
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
                  onChange={(e) => {
                    const m = [...input.manualTransfers];
                    m[idx] = { ...m[idx], to: e.target.value };
                    set({ manualTransfers: m });
                  }}
                  style={styles.select}
                >
                  {players.map((p, i) => (
                    <option key={i} value={i}>
                      {p}
                    </option>
                  ))}
                </select>
                <NumInput
                  width={64}
                  placeholder="点"
                  value={t.points}
                  onChange={(v) => {
                    const m = [...input.manualTransfers];
                    m[idx] = { ...m[idx], points: v };
                    set({ manualTransfers: m });
                  }}
                />
                <button
                  onClick={() =>
                    input.manualTransfers.length > 1 &&
                    set({ manualTransfers: input.manualTransfers.filter((_, i) => i !== idx) })
                  }
                  style={styles.iconBtn}
                  disabled={input.manualTransfers.length === 1}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => set({ manualTransfers: [...input.manualTransfers, { from: 0, to: 1, points: "" }] })}
            style={{ ...styles.secondary, marginTop: 10 }}
          >
            + 行を追加
          </button>
          <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>
            手入力のラウンドは倍率・ポットの計算対象外です
          </div>
        </div>
      )}

      {/* 確認表示 */}
      {input.type && (
        <div style={{ marginTop: 18 }}>
          {result?.error ? (
            <div style={{ fontSize: 13, color: "#999", padding: "10px 0" }}>{result.error}</div>
          ) : (
            result && <Preview players={players} result={result} pot={pot} multiplier={input.multiplier} type={input.type} />
          )}
          <button
            onClick={onCommit}
            disabled={!result || !!result.error}
            style={{ ...styles.primary, marginTop: 12, opacity: !result || result.error ? 0.35 : 1 }}
          >
            この内容で確定
          </button>
        </div>
      )}
      {!input.type && (
        <div style={{ fontSize: 13, color: "#999", marginTop: 12 }}>結果の種類を選んでください</div>
      )}
    </div>
  );
}

function Preview({ players, result, pot, multiplier, type }) {
  const potInSum = result.potIn.reduce((a, b) => a + b, 0);
  const potOutSum = result.potOut.reduce((a, b) => a + b, 0);
  const changed = result.deltas.map((d, i) => ({ d, i })).filter((x) => x.d !== 0);
  return (
    <div style={{ background: "#f7f5ef", borderRadius: 8, padding: 14, border: "1px dashed #d4d0c4" }}>
      <div style={{ ...styles.miniLabel, marginBottom: 8 }}>
        確認{type !== "manual" && multiplier > 1 ? `　倍率 ×${multiplier}` : ""}
      </div>
      {result.transfers.length > 0 && (
        <div style={{ display: "grid", gap: 4, marginBottom: 8 }}>
          {result.transfers.map((t, k) => (
            <div key={k} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14 }}>
              <Dot idx={t.from} size={8} />
              {players[t.from]} <span style={{ color: "#999" }}>→</span> <Dot idx={t.to} size={8} />
              {players[t.to]}
              <span style={{ marginLeft: "auto", fontFamily: "monospace", fontWeight: 700 }}>{t.points}</span>
            </div>
          ))}
        </div>
      )}
      {potInSum > 0 && (
        <div style={{ fontSize: 14, marginBottom: 6 }}>
          ポットへ：
          {result.potIn
            .map((v, i) => (v > 0 ? `${players[i]} ${v}` : null))
            .filter(Boolean)
            .join("、")}
          <span style={{ float: "right", fontFamily: "monospace", fontWeight: 700 }}>計 {potInSum}</span>
        </div>
      )}
      {potOutSum > 0 && (
        <div style={{ fontSize: 14, marginBottom: 6 }}>
          ポット獲得：
          {result.potOut
            .map((v, i) => (v > 0 ? `${players[i]} ${v}` : null))
            .filter(Boolean)
            .join("、")}
        </div>
      )}
      {pot !== result.potAfter && (
        <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>
          ポット {pot} → <strong>{result.potAfter}</strong>
        </div>
      )}
      <div style={{ borderTop: "1px solid #e5e2da", paddingTop: 8, display: "flex", flexWrap: "wrap", gap: "4px 12px" }}>
        {changed.length === 0 ? (
          <span style={{ fontSize: 13, color: "#999" }}>点数の変動なし</span>
        ) : (
          changed.map(({ d, i }) => (
            <span key={i} style={{ fontSize: 13 }}>
              {players[i]}{" "}
              <strong style={{ fontFamily: "monospace", color: d > 0 ? "#2A9D8F" : "#E63946" }}>
                {d > 0 ? `+${d}` : d}
              </strong>
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function RoundLog({ rounds, players }) {
  return (
    <div style={{ display: "grid", gap: 8, maxHeight: 260, overflowY: "auto" }}>
      {rounds
        .map((r, idx) => ({ r, idx }))
        .reverse()
        .map(({ r, idx }) => {
          const { head, moves } = describeRound(r, players);
          return (
            <div key={idx} style={{ padding: "8px 10px", background: "#f7f7f5", borderRadius: 4, fontSize: 13 }}>
              <div>
                <strong>R{idx + 1}</strong>
                {r.multiplier > 1 && (
                  <span style={{ color: "#E63946", fontWeight: 700, marginLeft: 6 }}>×{r.multiplier}</span>
                )}{" "}
                {head}
              </div>
              {moves.length > 0 && <div style={{ color: "#666", marginTop: 2 }}>{moves.join(" / ")}</div>}
            </div>
          );
        })}
    </div>
  );
}

function ScoreChart({ players, data, showPot, height, xDomain, yDomain, yTicks }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <CartesianGrid stroke="#eee" />
          <XAxis
            dataKey="round"
            stroke="#666"
            fontSize={12}
            {...(xDomain ? { type: "number", domain: xDomain, allowDecimals: false } : {})}
          />
          <YAxis
            stroke="#666"
            fontSize={12}
            width={40}
            allowDecimals={false}
            {...(yDomain ? { domain: yDomain, ticks: yTicks } : {})}
          />
          <Tooltip />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {players.map((p, i) => (
            <Line
              key={i}
              type="monotone"
              dataKey={p}
              stroke={PLAYER_COLORS[i % PLAYER_COLORS.length]}
              strokeWidth={2}
              dot={{ r: 2.5 }}
              isAnimationActive={false}
            />
          ))}
          {showPot && (
            <Line
              type="stepAfter"
              dataKey="ポット"
              stroke={POT_COLOR}
              strokeDasharray="4 3"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ============ 統計 ============
function StatsView({ players, rounds, potEnabled }) {
  const st = useMemo(() => computeStats(players, rounds), [players, rounds]);
  const hasPot = potEnabled || st.draws > 0 || st.potWins.some((v) => v > 0);
  const cats = [
    { key: "declared", label: "宣言回数" },
    { key: "gotBacked", label: "返された" },
    { key: "didBack", label: "返した" },
    { key: "gained", label: "得点合計" },
    { key: "lost", label: "失点合計" },
    ...(hasPot ? [{ key: "potWins", label: "ポット獲得" }] : []),
  ];
  const [cat, setCat] = useState("declared");
  const values = st[cat] || st.declared;
  const list = players.map((name, idx) => ({ name, idx, v: values[idx] })).sort((a, b) => b.v - a.v);
  const max = Math.max(1, ...list.map((x) => x.v));

  // 同率順位
  let rank = 0;
  let prev = null;
  const ranked = list.map((x, k) => {
    if (x.v !== prev) {
      rank = k + 1;
      prev = x.v;
    }
    return { ...x, rank };
  });

  return (
    <div>
      {hasPot && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div style={styles.statBox}>
            <div style={styles.miniLabel}>流局回数</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{st.draws}</div>
          </div>
          <div style={styles.statBox}>
            <div style={styles.miniLabel}>ポット最高額</div>
            <div style={{ fontSize: 24, fontWeight: 800 }}>{st.maxPot}</div>
          </div>
        </div>
      )}
      <Segmented small value={cat} onChange={setCat} options={cats.map((c) => ({ value: c.key, label: c.label }))} />
      <div style={{ display: "grid", gap: 6, marginTop: 12 }}>
        {ranked.map((x) => (
          <div key={x.idx} style={{ display: "grid", gridTemplateColumns: "22px 1fr 48px", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#999", fontWeight: 700 }}>{x.rank}</span>
            <div style={{ position: "relative", height: 26, display: "flex", alignItems: "center" }}>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 3,
                  bottom: 3,
                  width: `${(x.v / max) * 100}%`,
                  background: PLAYER_COLORS[x.idx % PLAYER_COLORS.length],
                  opacity: 0.18,
                  borderRadius: 3,
                }}
              />
              <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 6, fontSize: 14, paddingLeft: 6 }}>
                <Dot idx={x.idx} size={8} />
                {x.name}
              </span>
            </div>
            <span style={{ fontFamily: "monospace", fontSize: 15, textAlign: "right", fontWeight: 700 }}>{x.v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function niceStep(x) {
  if (!(x > 0)) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

// ============ CSV ============
async function exportCsv(game) {
  const csv = "﻿" + buildCsv(game.players, game.rounds);
  const d = new Date(game.startedAt || Date.now());
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(
    2,
    "0"
  )}_${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;
  const filename = `yaniv_${stamp}.csv`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  try {
    const file = new File([blob], filename, { type: "text/csv" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return;
    }
  } catch (e) {
    if (e && e.name === "AbortError") return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// ============ Result（現在ゲーム・履歴詳細の共通部分） ============
function ResultView({ game, mode = "current", onBackToPlay, onNewGame, onBack, onResume }) {
  const { players, rounds, settings } = game;
  const cumulative = useMemo(() => computeCumulative(players, rounds), [players, rounds]);
  const ranked = useMemo(() => computeRanked(players, cumulative.totals), [players, cumulative.totals]);
  const settlement = useMemo(() => computeSettlement(cumulative.totals), [cumulative.totals]);
  const pot = currentPot(rounds);
  const showPot = settings?.potEnabled || rounds.some((r) => r.type === "draw");

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
  const allValues = cumulative.series.flatMap((s) => [...players.map((p) => s[p]), ...(showPot ? [s["ポット"]] : [])]);
  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(0, ...allValues);
  const step = niceStep((rawMax - rawMin) / 5);
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.ceil(rawMax / step) * step;
  const yTicks = [];
  for (let v = yMin; v <= yMax; v += step) yTicks.push(v);

  const saveScreenshot = async () => {
    if (!shareRef.current) return;
    try {
      const dataUrl = await toPng(shareRef.current, { backgroundColor: "#f4f1ea", pixelRatio: 2 });
      const link = document.createElement("a");
      link.download = `yaniv-result-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
    } catch {
      alert("保存に失敗しました。ブラウザの設定を確認してください。");
    }
  };

  return (
    <>
      <div ref={shareRef} style={{ display: "grid", gap: 14 }}>
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
                  padding: "10px 0",
                  borderBottom: i === ranked.length - 1 ? "none" : "1px solid #eee",
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
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
                  <Dot idx={r.idx} />
                  <span style={{ fontWeight: 600 }}>{r.name}</span>
                </span>
                <span style={{ fontFamily: "monospace", fontSize: 18 }}>{r.score}</span>
              </li>
            ))}
          </ol>
          {pot > 0 && (
            <div style={{ fontSize: 12, color: "#999", marginTop: 8 }}>ポット残高 {pot}（誰にも配られていない点）</div>
          )}
        </div>

        <div style={styles.card}>
          <h2 style={styles.h2}>精算 — 全員を0にする</h2>
          {settlement.length === 0 ? (
            <p style={{ color: "#999", fontSize: 14, margin: 0 }}>精算は不要です。</p>
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
                    background: "#f7f5ef",
                    borderRadius: 6,
                    fontSize: 15,
                  }}
                >
                  <Dot idx={s.from} size={9} />
                  <strong>{players[s.from]}</strong>
                  <span style={{ color: "#999" }}>→</span>
                  <Dot idx={s.to} size={9} />
                  <strong>{players[s.to]}</strong>
                  <span style={{ marginLeft: "auto", fontFamily: "monospace", fontSize: 16, fontWeight: 700 }}>
                    {s.amount}
                  </span>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 11, color: "#aaa", margin: "10px 0 0" }}>
            マイナス（負債）の人がプラスの人に支払う形式
            {pot > 0 ? `。ポット残高${pot}点分はマイナス側の支払い残りになります` : ""}
          </p>
        </div>

        <div style={styles.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ ...styles.h2, margin: 0 }}>累計点の推移</h2>
            <span style={{ fontSize: 12, color: "#999", fontFamily: "monospace" }}>
              R{replayIdx} / {cumulative.series.length - 1}
            </span>
          </div>
          <ScoreChart
            players={players}
            data={visibleSeries}
            showPot={showPot}
            height={280}
            xDomain={[0, cumulative.series.length - 1]}
            yDomain={[yMin, yMax]}
            yTicks={yTicks}
          />
        </div>

        <div style={styles.card}>
          <h2 style={styles.h2}>統計</h2>
          <StatsView players={players} rounds={rounds} potEnabled={showPot} />
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
        <p style={{ fontSize: 11, color: "#999", margin: "4px 0 8px", textAlign: "center" }}>
          スライダーで任意の時点に / 画面録画はコントロールセンターから
        </p>

        <button onClick={saveScreenshot} style={styles.primary}>
          結果を画像で保存
        </button>
        <button onClick={() => exportCsv(game)} style={styles.secondary}>
          ラウンド記録をCSVで出力
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
            <button onClick={onResume} style={styles.secondary}>
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

function ResultScreen({ game, onBackToPlay, onNewGame, openHistory, historyCount }) {
  return (
    <Shell>
      <Header
        title="RESULT"
        right={
          historyCount > 0 && (
            <button onClick={openHistory} style={styles.linkBtn}>
              履歴 ({historyCount}) →
            </button>
          )
        }
      />
      <p style={styles.sub}>
        {game.rounds.length} rounds / {game.players.length} players · 履歴に保存済み
      </p>
      <ResultView game={game} mode="current" onBackToPlay={onBackToPlay} onNewGame={onNewGame} />
    </Shell>
  );
}

// ============ 履歴 ============
function HistoryListScreen({ history, onBack, onSelect, onDelete }) {
  return (
    <Shell>
      <Header
        title="HISTORY"
        right={
          <button onClick={onBack} style={styles.linkBtn}>
            ← 戻る
          </button>
        }
      />
      <p style={styles.sub}>{history.length} games</p>

      {history.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", color: "#999" }}>まだ記録がありません</div>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {history.map((h) => (
            <div key={h.id} style={styles.card}>
              <div onClick={() => onSelect(h.id)} style={{ cursor: "pointer" }}>
                <div style={{ fontSize: 11, color: "#999", letterSpacing: "0.05em" }}>
                  {formatDate(h.finishedAt || h.startedAt)}
                  {h.settings?.potEnabled ? "　流局ポットあり" : ""}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 6 }}>
                  <div>
                    <span style={{ fontSize: 18, fontWeight: 700 }}>1位 {h.winner}</span>
                    <span style={{ fontSize: 13, color: "#666", marginLeft: 8, fontFamily: "monospace" }}>
                      {h.winnerScore}
                    </span>
                  </div>
                  <span style={{ fontSize: 12, color: "#999" }}>
                    {h.players.length}人 / {h.rounds.length}R →
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>{h.players.join(" · ")}</div>
              </div>
              <button
                onClick={() => onDelete(h.id)}
                style={{ ...styles.linkBtn, color: "#c0392b", marginTop: 10, fontSize: 11 }}
              >
                削除
              </button>
            </div>
          ))}
        </div>
      )}
    </Shell>
  );
}

function HistoryDetailScreen({ entry, onBack, onResume }) {
  return (
    <Shell>
      <Header
        title="RESULT"
        right={
          <button onClick={onBack} style={styles.linkBtn}>
            ← 履歴
          </button>
        }
      />
      <p style={styles.sub}>
        {formatDate(entry.finishedAt || entry.startedAt)} · {entry.rounds.length} rounds / {entry.players.length}{" "}
        players
      </p>
      <ResultView game={entry} mode="history" onBack={onBack} onResume={onResume} />
    </Shell>
  );
}

// ============ styles ============
const styles = {
  h1: { fontSize: 32, fontWeight: 900, letterSpacing: "-0.02em", margin: 0 },
  h2: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: "#666",
    margin: "0 0 12px",
  },
  sub: { fontSize: 13, color: "#888", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 },
  miniLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "#888" },
  bigNum: { fontSize: 56, fontWeight: 900, lineHeight: 1, letterSpacing: "-0.03em", margin: "4px 0 6px" },
  card: { background: "#fff", borderRadius: 8, padding: 18, border: "1px solid #e5e2da" },
  statBox: { background: "#f7f5ef", borderRadius: 6, padding: "10px 12px" },
  label: {
    display: "block",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "#666",
    marginBottom: 8,
  },
  input: {
    flex: 1,
    padding: "10px 12px",
    fontSize: 16,
    border: "1px solid #d4d0c4",
    borderRadius: 4,
    background: "#fafaf7",
    outline: "none",
    minWidth: 0,
  },
  select: {
    padding: "10px 8px",
    fontSize: 16,
    border: "1px solid #d4d0c4",
    borderRadius: 4,
    background: "#fafaf7",
    outline: "none",
    minWidth: 0,
  },
  numBtn: {
    width: 44,
    height: 44,
    border: "1px solid #d4d0c4",
    borderRadius: 4,
    background: "#fff",
    fontSize: 16,
    fontWeight: 600,
    color: "#1a1a1a",
  },
  numBtnActive: { background: "#1a1a1a", color: "#fff", borderColor: "#1a1a1a" },
  chip: {
    padding: "8px 12px",
    border: "1px solid #d4d0c4",
    borderRadius: 20,
    background: "#fff",
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a1a",
  },
  chipActive: { background: "#1a1a1a", color: "#fff", borderColor: "#1a1a1a" },
  typeBtn: {
    padding: "14px 2px",
    border: "1px solid #d4d0c4",
    borderRadius: 6,
    background: "#fff",
    fontSize: 13,
    fontWeight: 800,
    whiteSpace: "nowrap",
    color: "#1a1a1a",
  },
  typeBtnActive: { background: "#1a1a1a", color: "#fff", borderColor: "#1a1a1a" },
  stepBtn: {
    width: 40,
    height: 40,
    border: "1px solid #d4d0c4",
    borderRadius: 20,
    background: "#fff",
    fontSize: 20,
    color: "#1a1a1a",
  },
  primary: {
    width: "100%",
    padding: "14px",
    background: "#1a1a1a",
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 15,
    fontWeight: 700,
    letterSpacing: "0.05em",
  },
  secondary: {
    width: "100%",
    padding: "11px",
    background: "#fff",
    color: "#1a1a1a",
    border: "1px solid #1a1a1a",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
  },
  danger: {
    width: "100%",
    padding: "11px",
    background: "#fff",
    color: "#c0392b",
    border: "1px solid #c0392b",
    borderRadius: 6,
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
  linkBtn: { background: "none", border: "none", color: "#666", fontSize: 13, fontWeight: 600, padding: 0 },
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
  doubleAlert: {
    background: "#E63946",
    color: "#fff",
    borderRadius: 10,
    padding: 18,
    animation: "pulse 1.6s ease-in-out infinite",
  },
  alertBtnPrimary: {
    padding: "12px 6px",
    background: "#fff",
    color: "#E63946",
    border: "none",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 800,
  },
  alertBtn: {
    padding: "12px 6px",
    background: "transparent",
    color: "#fff",
    border: "1px solid rgba(255,255,255,0.7)",
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 700,
  },
};
