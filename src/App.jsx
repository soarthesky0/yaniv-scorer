import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from "recharts";
import { toBlob } from "html-to-image";
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
  nextStarter,
  computeStats,
  describeRound,
  buildCsv,
} from "./logic.js";
import { RulesSheet, RulesFab, recommendFor } from "./RulesPages.jsx";
import { LiveBar, LiveSheet, useLivePublisher } from "./LiveUI.jsx";
import { newRoomCode, normalizeCode, isValidCode } from "./live.js";

// 参加順に割り当てる色。先頭から何色取っても互いの差（色差ΔE）が最大になるように並べてある
// （2人:124 / 4人:73 / 7人:50 / 12人:33）
export const PLAYER_COLORS = [
  "#E03131", // 赤
  "#1C64F2", // 青
  "#14953F", // 緑
  "#3F4A5A", // スレート
  "#C99100", // からし
  "#E0399A", // ピンク
  "#5BA8F5", // 空色
  "#F28B95", // ローズ
  "#1E2F7A", // 紺
  "#8A4B12", // 茶
  "#6B7A1F", // オリーブ
  "#7BB31A", // ライム
];
export const POT_COLOR = "#8a8577";
const MAX_PLAYERS = 12;
const STORAGE_KEY = "yaniv-scorer-v2";
const TRASH_DAYS = 30; // 最近削除した項目の保持日数
const DAY_MS = 86400000;

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
  joinedAt: [],
});

function normalizeGame(g) {
  const players = g.players || [];
  return {
    ...g,
    rounds: normalizeRounds(g.rounds, players.length),
    settings: { ...DEFAULT_SETTINGS, ...(g.settings || {}) },
    doubleLog: g.doubleLog || {},
    joinedAt: players.map((_, i) => (g.joinedAt && g.joinedAt[i]) || 0),
  };
}

// 保存データ（localStorage・バックアップファイル共通）を読み込める形に整える
function parseStore(parsed) {
  const lastSettings = { ...DEFAULT_SETTINGS, ...(parsed.lastSettings || {}) };
  const cur = { ...emptyCurrent(lastSettings), ...(parsed.current || {}) };
  if (!cur.nameInputs || cur.nameInputs.length < MAX_PLAYERS) {
    cur.nameInputs = [...(cur.nameInputs || []), ...defaultNames()].slice(0, MAX_PLAYERS);
  }
  return {
    current: normalizeGame(cur),
    history: Array.isArray(parsed.history) ? parsed.history.map(normalizeGame) : [],
    // 保持期間を過ぎたものはここで消える
    trash: Array.isArray(parsed.trash)
      ? parsed.trash
          .filter((t) => Date.now() - new Date(t.deletedAt).getTime() < TRASH_DAYS * DAY_MS)
          .map((t) => ({ ...normalizeGame(t), deletedAt: t.deletedAt }))
      : [],
    lastSettings,
    lastBackupAt: parsed.lastBackupAt || null,
    live:
      parsed.live && isValidCode(parsed.live.code)
        ? { code: parsed.live.code, on: !!parsed.live.on }
        : { code: null, on: false },
  };
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return parseStore({});
    return parseStore(JSON.parse(raw));
  } catch {
    return parseStore({});
  }
}

const sortByFinished = (list) =>
  [...list].sort(
    (a, b) => new Date(b.finishedAt || b.startedAt || 0).getTime() - new Date(a.finishedAt || a.startedAt || 0).getTime()
  );

// 共有シート（iPhone）か、だめならダウンロード
async function shareOrDownload(blob, filename, type) {
  try {
    const file = new File([blob], filename, { type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: filename });
      return "shared";
    }
  } catch (e) {
    if (e && e.name === "AbortError") return "aborted";
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded";
}

const stampOf = (d) =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}_${String(
    d.getHours()
  ).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}`;

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
  const [trash, setTrash] = useState(initial.trash);
  const [lastBackupAt, setLastBackupAt] = useState(initial.lastBackupAt);
  const [live, setLive] = useState(initial.live);
  const [liveOpen, setLiveOpen] = useState(false);
  const [toast, setToast] = useState(null); // { text, undo }
  const toastTimer = useRef(null);
  const showToast = (t) => {
    clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  };
  const [lastSettings, setLastSettings] = useState(initial.lastSettings);
  const [view, setView] = useState({ type: "main" });
  const [rulesTab, setRulesTab] = useState(null); // null | "rules" | "quick"
  // 過去に出た名前（多い順、同数なら最近の順）
  const knownNames = useMemo(() => {
    const count = {};
    const recent = {};
    history.forEach((h, gi) => {
      h.players.forEach((n) => {
        count[n] = (count[n] || 0) + 1;
        if (recent[n] === undefined) recent[n] = gi;
      });
    });
    return Object.keys(count).sort((a, b) => count[b] - count[a] || recent[a] - recent[b]);
  }, [history]);
  const lastMembers = history[0]?.players || null;
  const rulesPlayerCount = current.phase === "setup" ? current.numPlayers : current.players.length;
  const wrap = (screen) => (
    <>
      {screen}
      {!rulesTab && <RulesFab onOpen={() => setRulesTab("rules")} />}
      {liveOpen && (
        <LiveSheet
          live={live}
          status={liveStatus}
          onStart={startLive}
          onStop={stopLive}
          onRenew={renewLive}
          onClose={() => setLiveOpen(false)}
        />
      )}
      {toast && (
        <div style={styles.toast}>
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              onClick={() => {
                toast.undo();
                setToast(null);
              }}
              style={{ background: "none", border: "none", color: "#F4A261", fontSize: 15, fontWeight: 800, padding: "4px 0" }}
            >
              元に戻す
            </button>
          )}
        </div>
      )}
      {rulesTab && (
        <RulesSheet
          tab={rulesTab}
          setTab={setRulesTab}
          settings={current.settings}
          playerCount={rulesPlayerCount}
          onClose={() => setRulesTab(null)}
        />
      )}
    </>
  );

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ current, history, trash, lastSettings, lastBackupAt, live }));
    } catch {}
  }, [current, history, trash, lastSettings, lastBackupAt, live]);

  // ===== ライブ共有 =====
  const { status: liveStatus, sendEnd } = useLivePublisher(live, current);
  const startLive = () => setLive({ code: live.code || newRoomCode(), on: true });
  const stopLive = async () => {
    if (!confirm("ライブ共有をやめる？見ている人の画面は「終了しました」になります")) return;
    const code = live.code;
    setLive({ code, on: false });
    await sendEnd(code);
  };
  const renewLive = async () => {
    if (!confirm("リンクを作り直す？今までのリンクやQRでは見られなくなります")) return;
    const old = live.code;
    setLive({ code: newRoomCode(), on: true });
    if (old) await sendEnd(old);
  };
  const liveBar = <LiveBar live={live} status={liveStatus} onOpen={() => setLiveOpen(true)} />;

  // ===== バックアップ =====
  const exportBackup = async () => {
    const now = new Date();
    const payload = {
      app: "yaniv-scorer",
      version: 1,
      exportedAt: now.toISOString(),
      data: { current, history, trash, lastSettings },
    };
    const blob = new Blob([JSON.stringify(payload)], { type: "application/json" });
    const res = await shareOrDownload(blob, `yaniv_backup_${stampOf(now)}.json`, "application/json");
    if (res !== "aborted") {
      setLastBackupAt(now.toISOString());
      showToast({ text: "バックアップを書き出しました" });
    }
  };

  const importBackup = async (file) => {
    let parsed;
    try {
      const json = JSON.parse(await file.text());
      if (json.app !== "yaniv-scorer" || !json.data) throw new Error("format");
      parsed = parseStore(json.data);
    } catch {
      alert("このファイルは読み込めませんでした。ヤニブ得点計算機のバックアップ（.json）を選んでください。");
      return;
    }
    const known = new Set(history.map((h) => h.id));
    const added = parsed.history.filter((h) => !known.has(h.id));
    const curLocalEmpty = current.rounds.length === 0;
    const takeCurrent = curLocalEmpty && parsed.current.rounds.length > 0 && parsed.current.phase === "play";
    if (added.length === 0 && !takeCurrent) {
      alert("新しく追加される試合はありませんでした（すべて取り込み済み）");
      return;
    }
    const msg =
      `${added.length}試合を履歴に追加します` +
      (takeCurrent ? "\n進行中だった試合も復元します" : "") +
      "\n（今ある記録は消えません）";
    if (!confirm(msg)) return;
    setHistory((prev) => sortByFinished([...prev, ...added]));
    const trashIds = new Set([...trash.map((t) => t.id), ...history.map((h) => h.id), ...added.map((h) => h.id)]);
    setTrash((prev) => [...prev, ...parsed.trash.filter((t) => !trashIds.has(t.id))]);
    if (takeCurrent) setCurrent(parsed.current);
    showToast({ text: `${added.length}試合を読み込みました` });
  };

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
      joinedAt: names.map(() => 0),
      phase: "play",
      startedAt: new Date().toISOString(),
    });
  };

  const goResult = () => {
    if (current.rounds.length === 0) return;
    const cum = computeCumulative(current.players, current.rounds, current.joinedAt);
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
      joinedAt: current.joinedAt,
      winner: ranked[0]?.name || "",
      winnerScore: ranked[0]?.score ?? 0,
    };
    setHistory((prev) => [entry, ...prev.filter((h) => h.id !== entry.id)]);
    updateCurrent({ phase: "result" });
  };

  const newGame = () => {
    if (current.rounds.length > 0 && current.phase !== "result") {
      if (!confirm("進行中のゲームを破棄して新しく始める？")) return false;
    }
    setCurrent({
      ...emptyCurrent(lastSettings),
      numPlayers: current.numPlayers,
      nameInputs: current.nameInputs,
    });
    return true;
  };

  // 削除はゴミ箱へ移すだけ（30日間は復元できる）
  const deleteHistory = (id) => {
    const entry = history.find((h) => h.id === id);
    if (!entry) return;
    const removed = { ...entry, deletedAt: new Date().toISOString() };
    setHistory((prev) => prev.filter((h) => h.id !== id));
    setTrash((prev) => [removed, ...prev.filter((t) => t.id !== id)]);
    showToast({ text: "最近削除した項目に移しました", undo: () => restoreHistory(id) });
  };

  const restoreHistory = (id) => {
    setTrash((prevTrash) => {
      const entry = prevTrash.find((t) => t.id === id);
      if (entry) {
        const { deletedAt, ...rest } = entry;
        setHistory((prev) => sortByFinished([rest, ...prev.filter((h) => h.id !== id)]));
      }
      return prevTrash.filter((t) => t.id !== id);
    });
  };

  const purgeTrash = (id) => {
    if (!confirm(id ? "この試合を完全に削除する？元に戻せません" : "すべて完全に削除する？元に戻せません")) return;
    setTrash((prev) => (id ? prev.filter((t) => t.id !== id) : []));
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
      joinedAt: entry.players.map((_, i) => (entry.joinedAt && entry.joinedAt[i]) || 0),
    });
    setView({ type: "main" });
  };

  if (view.type === "trash") {
    return wrap(
      <TrashScreen
        trash={trash}
        onBack={() => setView({ type: "history-list" })}
        onRestore={(id) => {
          restoreHistory(id);
          showToast({ text: "履歴に戻しました" });
        }}
        onPurge={purgeTrash}
      />
    );
  }

  if (view.type === "history-list" || (view.type === "history-detail" && !history.find((h) => h.id === view.id))) {
    return wrap(
      <HistoryListScreen
        history={history}
        onBack={() => setView({ type: "main" })}
        onSelect={(id) => setView({ type: "history-detail", id })}
        onDelete={deleteHistory}
        trashCount={trash.length}
        openTrash={() => setView({ type: "trash" })}
        lastBackupAt={lastBackupAt}
        onExport={exportBackup}
        onImport={importBackup}
        onNewGame={() => {
          if (newGame()) setView({ type: "main" });
        }}
      />
    );
  }

  if (view.type === "history-detail") {
    const entry = history.find((h) => h.id === view.id);
    return wrap(
      <HistoryDetailScreen
        entry={entry}
        onBack={() => setView({ type: "history-list" })}
        onResume={() => resumeGame(entry.id)}
      />
    );
  }

  if (current.phase === "setup") {
    return wrap(
      <SetupScreen
        current={current}
        updateCurrent={updateCurrent}
        updateSettings={updateSettings}
        startGame={startGame}
        historyCount={history.length}
        openHistory={() => setView({ type: "history-list" })}
        openRules={setRulesTab}
        knownNames={knownNames}
        lastMembers={lastMembers}
        liveBar={live.on ? liveBar : null}
      />
    );
  }

  if (current.phase === "result") {
    return wrap(
      <ResultScreen
        game={current}
        onBackToPlay={() => updateCurrent({ phase: "play" })}
        onNewGame={newGame}
        openHistory={() => setView({ type: "history-list" })}
        historyCount={history.length}
        liveBar={liveBar}
      />
    );
  }

  return wrap(
    <PlayScreen
      game={current}
      updateCurrent={updateCurrent}
      updateSettings={updateSettings}
      goResult={goResult}
      onNewGame={newGame}
      knownNames={knownNames}
      liveBar={liveBar}
    />
  );
}

// ============ 共通パーツ ============
export function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", padding: "calc(env(safe-area-inset-top, 0px) + 24px) 16px 96px" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", display: "grid", gap: 14 }}>{children}</div>
    </div>
  );
}

export function Header({ title, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
      <h1 style={styles.h1}>{title}</h1>
      <div style={{ display: "flex", gap: 8 }}>{right}</div>
    </div>
  );
}

export function Dot({ idx, size = 10 }) {
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
            ...(o.activeColor && value === o.value ? { background: o.activeColor, boxShadow: `inset 0 0 0 1px ${o.activeColor}` } : {}),
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

function NameChips({ names, onPick }) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {names.map((n) => (
        <button
          key={n}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(n)}
          style={{ ...styles.chip, padding: "7px 12px", fontSize: 14 }}
        >
          {n}
        </button>
      ))}
    </div>
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
              note="オンだと（手札合計−宣言ライン）×倍率をポットへ"
              value={s.multiplyPotIn}
              onChange={(v) => onChange({ multiplyPotIn: v })}
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

      <div style={{ borderTop: "1px solid #eee", paddingTop: 16, display: "grid", gap: 14 }}>
        <div style={{ fontSize: 11, color: "#999" }}>
          宣言ラインは流局ポットの支払い（手札合計−宣言ライン）にも使います。デッキ数はルール解説の表示用です
        </div>
        <div>
          <label style={styles.label}>宣言ライン</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button style={styles.stepBtn} onClick={() => onChange({ declareLine: Math.max(0, (s.declareLine ?? 5) - 1) })}>
              −
            </button>
            <span style={{ fontSize: 18, fontWeight: 700, minWidth: 90, textAlign: "center" }}>{s.declareLine ?? 5}点以下</span>
            <button style={styles.stepBtn} onClick={() => onChange({ declareLine: (s.declareLine ?? 5) + 1 })}>
              ＋
            </button>
          </div>
        </div>
        <div>
          <label style={styles.label}>デッキ数</label>
          <Segmented
            small
            value={s.deckCount || 1}
            onChange={(v) => onChange({ deckCount: v })}
            options={[
              { value: 1, label: "1つ（54枚）" },
              { value: 2, label: "2つ（108枚）" },
            ]}
          />
        </div>
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
          <button onClick={onClose} style={styles.headerBtn}>
            閉じる
          </button>
        </div>
        <SettingsFields settings={settings} onChange={onChange} inGame />
      </div>
    </div>
  );
}

// ============ Setup ============
function SetupScreen({
  current,
  updateCurrent,
  updateSettings,
  startGame,
  historyCount,
  openHistory,
  openRules,
  knownNames = [],
  lastMembers,
  liveBar,
}) {
  const { numPlayers, nameInputs } = current;
  const rec = recommendFor(numPlayers);
  const pickCount = (n) => {
    updateCurrent({ numPlayers: n });
    updateSettings(recommendFor(n)); // おすすめを初期値として入れる（あとで変更自由）
  };

  // 名前欄：未入力（空欄かP1などの仮名）かどうか
  const isBlank = (v) => !v || !v.trim() || /^P\d+$/.test(v.trim());
  const [focusIdx, setFocusIdx] = useState(null);
  const active = nameInputs.slice(0, numPlayers);
  const suggestions = knownNames.filter((n) => !active.some((v) => v.trim() === n));
  const fillName = (name) => {
    let target = focusIdx !== null && focusIdx < numPlayers ? focusIdx : active.findIndex(isBlank);
    if (target < 0) return;
    const next = [...nameInputs];
    next[target] = name;
    updateCurrent({ nameInputs: next });
    // 次の空き欄へ
    const after = next.slice(0, numPlayers).findIndex((v, i) => i > target && isBlank(v));
    const anyBlank = next.slice(0, numPlayers).findIndex(isBlank);
    setFocusIdx(after >= 0 ? after : anyBlank >= 0 ? anyBlank : null);
  };

  const sameAsLast =
    lastMembers && lastMembers.length === numPlayers && lastMembers.every((n, i) => active[i]?.trim() === n);
  const useLastMembers = () => {
    const n = lastMembers.length;
    const next = [...nameInputs];
    lastMembers.forEach((name, i) => (next[i] = name));
    updateCurrent({ numPlayers: n, nameInputs: next });
    updateSettings(recommendFor(n));
    setFocusIdx(null);
  };
  return (
    <Shell>
      <Header
        title="YANIV"
        right={
          <button onClick={openHistory} style={styles.headerBtn}>
            履歴{historyCount > 0 ? ` (${historyCount})` : ""} →
          </button>
        }
      />
      <p style={styles.sub}>得点計算機 / setup</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button onClick={() => openRules("rules")} style={styles.homeLink}>
          <span style={{ fontSize: 16, fontWeight: 900 }}>ルール解説</span>
          <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>図つきで確認</span>
        </button>
        <button onClick={() => openRules("quick")} style={styles.homeLink}>
          <span style={{ fontSize: 16, fontWeight: 900 }}>早見表</span>
          <span style={{ fontSize: 11, color: "#888", fontWeight: 600 }}>点数例・人数別</span>
        </button>
      </div>

      {liveBar}

      <button
        onClick={() => {
          const text = prompt("ライブのコードかリンクを入力");
          if (text === null) return;
          const code = normalizeCode(text);
          if (!isValidCode(code)) {
            alert("コードが正しくありません");
            return;
          }
          window.location.href = `/?live=${code}`;
        }}
        style={{ ...styles.linkBtn, alignSelf: "start", justifySelf: "start", fontSize: 13 }}
      >
        共有されたライブを見る →
      </button>

      <div style={styles.card}>
        {lastMembers && lastMembers.length >= 2 && (
          <button
            onClick={useLastMembers}
            disabled={sameAsLast}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
              padding: "12px 14px",
              marginBottom: 18,
              border: "none",
              borderRadius: 10,
              background: sameAsLast ? "#f7f5ef" : "#1a1a1a",
              color: sameAsLast ? "#999" : "#fff",
              textAlign: "left",
            }}
          >
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 15, fontWeight: 800 }}>
                {sameAsLast ? "前回のメンバーを入力済み" : "前回のメンバーで始める"}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 12,
                  opacity: 0.75,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {lastMembers.length}人 · {lastMembers.join("・")}
              </span>
            </span>
            {!sameAsLast && <span style={{ fontSize: 20, fontWeight: 300 }}>→</span>}
          </button>
        )}

        <label style={styles.label}>人数</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Array.from({ length: MAX_PLAYERS - 1 }, (_, i) => i + 2).map((n) => (
            <button
              key={n}
              onClick={() => pickCount(n)}
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
                onFocus={(e) => {
                  setFocusIdx(i);
                  if (/^P\d+$/.test(e.target.value)) e.target.select();
                }}
                onChange={(e) => {
                  const next = [...nameInputs];
                  next[i] = e.target.value;
                  updateCurrent({ nameInputs: next });
                }}
                style={{
                  ...styles.input,
                  ...(focusIdx === i ? { boxShadow: "0 0 0 2px #1a1a1a", borderColor: "#1a1a1a" } : {}),
                }}
                placeholder={`P${i + 1}`}
              />
            </div>
          ))}
        </div>
        {suggestions.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: "#999", marginBottom: 6 }}>
              タップで{focusIdx !== null && focusIdx < numPlayers ? `${focusIdx + 1}人目` : "空いている欄"}に入力
            </div>
            <NameChips names={suggestions} onPick={fillName} />
          </div>
        )}
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>ルール設定</h2>
        <div style={{ fontSize: 12, color: "#666", background: "#f7f5ef", borderRadius: 6, padding: "8px 10px", marginBottom: 16 }}>
          {numPlayers}人のおすすめ：{rec.deckCount}デッキ・宣言ライン{rec.declareLine}点・流局ポットオン
          {current.settings.potEnabled ? "" : "（今はオフ）"}
        </div>
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

function PlayScreen({ game, updateCurrent, updateSettings, goResult, onNewGame, knownNames = [], liveBar }) {
  const { players, rounds, settings, doubleLog } = game;
  const joinedAt = game.joinedAt || [];
  const roundNo = rounds.length + 1;
  const pot = currentPot(rounds);
  const cumulative = useMemo(() => computeCumulative(players, rounds, joinedAt), [players, rounds, joinedAt]);
  const [input, setInput] = useState(() => emptyInput(players.length));
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinName, setJoinName] = useState("");

  // 人数が変わったら流局入力の欄を合わせる
  useEffect(() => {
    setInput((prev) =>
      prev.hands.length === players.length
        ? prev
        : {
            ...prev,
            hands: players.map((_, i) => prev.hands[i] ?? ""),
            declarer: prev.declarer !== null && prev.declarer >= players.length ? null : prev.declarer,
            targets: prev.targets.filter((t) => t < players.length),
          }
    );
  }, [players.length]);

  const addPlayer = () => {
    const name = joinName.trim();
    if (!name) return;
    if (players.includes(name)) {
      alert("同じ名前のプレイヤーがいます");
      return;
    }
    if (players.length >= MAX_PLAYERS) return;
    updateCurrent((prev) => {
      const nameInputs = [...prev.nameInputs];
      nameInputs[prev.players.length] = name;
      return {
        players: [...prev.players, name],
        joinedAt: [...prev.players.map((_, i) => (prev.joinedAt || [])[i] || 0), prev.rounds.length],
        numPlayers: prev.players.length + 1,
        nameInputs,
      };
    });
    setJoinName("");
    setJoinOpen(false);
  };

  // 参加してからまだラウンドが進んでいない最後のプレイヤーは取り消せる
  const lastIdx = players.length - 1;
  const canRemoveLast = players.length > 2 && (joinedAt[lastIdx] || 0) > 0 && joinedAt[lastIdx] === rounds.length;
  const removeLast = () => {
    if (!confirm(`${players[lastIdx]}の参加を取り消す？`)) return;
    updateCurrent((prev) => ({
      players: prev.players.slice(0, -1),
      joinedAt: (prev.joinedAt || []).slice(0, prev.players.length - 1),
      numPlayers: prev.players.length - 1,
    }));
  };
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
      ...(input.type === "draw" ? { hands: input.hands.map(Number), declareLine: Number(settings.declareLine ?? 5) } : {}),
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
    const newLen = rounds.length - 1;
    updateCurrent({
      rounds: rounds.slice(0, -1),
      joinedAt: joinedAt.map((j) => Math.min(j || 0, newLen)),
      ...(last.doubleLogBefore ? { doubleLog: last.doubleLogBefore } : {}),
    });
  };

  return (
    <Shell>
      <Header
        title="YANIV"
        right={
          <>
            <button onClick={() => setSettingsOpen(true)} style={styles.headerBtn}>
              設定
            </button>
            <button onClick={onNewGame} style={styles.headerBtn}>
              新規ゲーム
            </button>
          </>
        }
      />

      {liveBar}

      {/* ラウンド数・ポット */}
      <div style={{ ...styles.card, display: "flex", alignItems: "stretch", padding: 0, overflow: "hidden" }}>
        <div style={{ flex: 1, padding: "14px 18px" }}>
          <div style={styles.miniLabel}>ROUND</div>
          <div style={styles.bigNum}>{roundNo}</div>
          {nextDouble && (
            <div style={{ fontSize: 11, color: "#999" }}>
              倍マッチ：{nextDouble === roundNo ? "今回" : `R${nextDouble}`}
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

      {rounds.length > 0 && (
        <NextStarter players={players} info={nextStarter(rounds[rounds.length - 1], players.length)} prevRound={rounds.length} />
      )}

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
                {(joinedAt[i] || 0) > 0 && (
                  <span style={{ fontSize: 11, color: "#999" }}>R{joinedAt[i] + 1}から参加</span>
                )}
                {i === lastIdx && canRemoveLast && (
                  <button onClick={removeLast} style={{ ...styles.linkBtn, fontSize: 12, color: "#c0392b" }}>
                    取消
                  </button>
                )}
              </span>
              <span style={{ fontFamily: "monospace", fontSize: 16 }}>{cumulative.totals[i]}</span>
            </div>
          ))}
        </div>
        {players.length < MAX_PLAYERS &&
          (joinOpen ? (
            <div style={{ marginTop: 14, borderTop: "1px solid #eee", paddingTop: 14 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={joinName}
                  autoFocus
                  onChange={(e) => setJoinName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && addPlayer()}
                  placeholder="参加する人の名前"
                  style={styles.input}
                />
                <button onClick={addPlayer} style={{ ...styles.headerBtn, background: "#1a1a1a", color: "#fff" }}>
                  追加
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>
                R{roundNo}から参加、持ち点0で始まります
              </div>
              {knownNames.filter((n) => !players.includes(n)).length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <NameChips names={knownNames.filter((n) => !players.includes(n))} onPick={(n) => setJoinName(n)} />
                </div>
              )}
              <button onClick={() => setJoinOpen(false)} style={{ ...styles.linkBtn, marginTop: 4 }}>
                やめる
              </button>
            </div>
          ) : (
            <button onClick={() => setJoinOpen(true)} style={{ ...styles.secondary, marginTop: 14 }}>
              ＋ 途中参加を追加
            </button>
          ))}
      </div>

      {rounds.length > 0 && (
        <Collapsible title="推移" open={chartOpen} setOpen={setChartOpen} className="bleed">
          <ScoreChart players={players} data={cumulative.series} rounds={rounds} showPot={settings.potEnabled} height={240} />
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

function Collapsible({ title, open, setOpen, children, className }) {
  return (
    <div style={styles.card} className={className}>
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
  // 倍マッチ中（アナウンス済み）なのに倍率が×1のまま
  const inDouble = !!(double && double.announced);
  const needMult = inDouble && input.type && input.type !== "manual" && input.multiplier === 1;

  const selectType = (t) => {
    // 種類を変えたときは選択内容を保ったまま切り替え（倍率は維持）
    set({ type: t, targets: input.targets.filter((x) => x !== input.declarer) });
  };

  return (
    <div
      style={{
        ...styles.card,
        ...(inDouble ? { border: "none", boxShadow: "inset 0 0 0 3px #E63946", paddingTop: 0, overflow: "hidden" } : {}),
      }}
    >
      {inDouble && (
        <div
          style={{
            margin: "0 -18px 16px",
            padding: "10px 18px",
            background: "#E63946",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 17, fontWeight: 900 }}>倍マッチ中</span>
          <span style={{ fontSize: 12, fontWeight: 700, opacity: 0.95 }}>倍率（×2／×3）を選んでから確定</span>
        </div>
      )}
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
        <div
          style={{
            marginTop: 16,
            ...(needMult
              ? { background: "#fff1f2", boxShadow: "inset 0 0 0 2px #E63946", borderRadius: 10, padding: "12px 12px 14px" }
              : {}),
          }}
        >
          <label style={{ ...styles.label, ...(needMult ? { color: "#E63946" } : {}) }}>倍率</label>
          <div className={needMult ? "mult-attn" : undefined}>
            <Segmented
              value={input.multiplier}
              onChange={(v) => set({ multiplier: v })}
              options={[
                { value: 1, label: "×1" },
                { value: 2, label: "×2", activeColor: "#E63946" },
                { value: 3, label: "×3", activeColor: "#E63946" },
              ]}
            />
          </div>
          {needMult && (
            <div style={{ fontSize: 14, fontWeight: 800, color: "#E63946", marginTop: 8 }}>
              倍率が×1のままです。倍マッチなら×2か×3を選んでください
            </div>
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
          <div style={{ fontSize: 12, color: "#666", marginTop: -4, marginBottom: 10 }}>
            ポットに入るのは「手札合計−{settings.declareLine ?? 5}」点（宣言ライン以下の人は0点）
          </div>
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
            style={{
              ...styles.primary,
              marginTop: 12,
              opacity: !result || result.error ? 0.35 : 1,
              ...(needMult ? { background: "#fff", color: "#E63946", boxShadow: "inset 0 0 0 2px #E63946" } : {}),
              ...(inDouble && input.multiplier > 1 && input.type !== "manual" ? { background: "#E63946" } : {}),
            }}
          >
            {needMult
              ? "倍率×1のまま確定する"
              : input.type !== "manual" && input.multiplier > 1
                ? `×${input.multiplier}で確定`
                : "この内容で確定"}
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
      <div style={{ ...styles.miniLabel, marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
        確認
        {type !== "manual" && multiplier > 1 && (
          <span
            style={{
              background: "#E63946",
              color: "#fff",
              borderRadius: 10,
              padding: "2px 10px",
              fontSize: 13,
              fontWeight: 900,
              letterSpacing: 0,
            }}
          >
            倍率 ×{multiplier}
          </span>
        )}
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

const MARKS = [
  { key: "back", label: "返し", color: "#E63946", opacity: 0.14, test: (r) => r.type === "back" },
  { key: "draw", label: "流局", color: "#6b675c", opacity: 0.14, test: (r) => r.type === "draw" },
  { key: "mult", label: "倍率", color: "#F4A261", opacity: 0.22, test: (r) => (r.multiplier || 1) > 1 },
];

export function ScoreChart({ players, data, rounds = [], showPot, height, xDomain, yDomain, yTicks }) {
  // 幅に合わせて高さも伸ばす（スマホは指定の高さ、iPadなど横幅が広いときは幅の約4割）
  const boxRef = useRef(null);
  const [boxWidth, setBoxWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => setBoxWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const chartHeight = boxWidth > 560 ? Math.round(Math.min(640, Math.max(height, boxWidth * 0.42))) : height;
  const [focus, setFocus] = useState([]);
  const [marks, setMarks] = useState({ back: true, draw: false, mult: false });
  const lastRound = data.length ? data[data.length - 1].round : 0;
  const domain = xDomain || [0, Math.max(1, lastRound)];
  const visibleRounds = rounds.slice(0, lastRound);
  const availableMarks = MARKS.filter((m) => rounds.some(m.test));

  const toggleFocus = (i) =>
    setFocus((prev) => (prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]));

  // 返されたラウンドの宣言者の点を目立たせる
  const backedAt = {};
  visibleRounds.forEach((r, k) => {
    if (r.type === "back") backedAt[`${k + 1}-${r.declarer}`] = true;
  });
  const makeDot = (i) => (props) => {
    const { cx, cy, payload, key } = props;
    if (cx == null || cy == null) return null;
    const faded = focus.length > 0 && !focus.includes(i);
    if (marks.back && backedAt[`${payload.round}-${i}`]) {
      return (
        <g key={key}>
          <circle cx={cx} cy={cy} r={6} fill="#E63946" stroke="#fff" strokeWidth={2} opacity={faded ? 0.25 : 1} />
        </g>
      );
    }
    if (faded) return <g key={key} />;
    return <circle key={key} cx={cx} cy={cy} r={2.5} fill="#fff" stroke={PLAYER_COLORS[i % PLAYER_COLORS.length]} strokeWidth={1.5} />;
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {players.map((p, i) => {
          const on = focus.length === 0 || focus.includes(i);
          return (
            <button
              key={i}
              onClick={() => toggleFocus(i)}
              style={{
                ...styles.miniChip,
                opacity: on ? 1 : 0.35,
                ...(focus.includes(i) ? { boxShadow: "inset 0 0 0 1.5px #1a1a1a" } : {}),
              }}
            >
              <Dot idx={i} size={8} />
              {p}
            </button>
          );
        })}
        {focus.length > 0 && (
          <button onClick={() => setFocus([])} style={{ ...styles.miniChip, color: "#666" }}>
            全員表示
          </button>
        )}
      </div>

      {availableMarks.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: "#999", fontWeight: 700 }}>色付け</span>
          {availableMarks.map((m) => (
            <button
              key={m.key}
              onClick={() => setMarks((prev) => ({ ...prev, [m.key]: !prev[m.key] }))}
              style={{
                ...styles.miniChip,
                ...(marks[m.key]
                  ? { background: m.color, color: "#fff", boxShadow: `inset 0 0 0 1px ${m.color}` }
                  : {}),
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      <div ref={boxRef} style={{ width: "100%", height: chartHeight }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="#eee" />
            {MARKS.filter((m) => marks[m.key]).flatMap((m) =>
              visibleRounds.map((r, k) =>
                m.test(r) ? (
                  <ReferenceArea
                    key={`${m.key}-${k}`}
                    x1={k}
                    x2={k + 1}
                    fill={m.color}
                    fillOpacity={m.opacity}
                    stroke="none"
                    ifOverflow="hidden"
                  />
                ) : null
              )
            )}
            <XAxis dataKey="round" stroke="#666" fontSize={12} type="number" domain={domain} allowDecimals={false} />
            <YAxis
              stroke="#666"
              fontSize={12}
              width={40}
              allowDecimals={false}
              {...(yDomain ? { domain: yDomain, ticks: yTicks } : {})}
            />
            <Tooltip />
            {players.map((p, i) => {
              const faded = focus.length > 0 && !focus.includes(i);
              return (
                <Line
                  key={i}
                  type="monotone"
                  dataKey={p}
                  stroke={PLAYER_COLORS[i % PLAYER_COLORS.length]}
                  strokeWidth={faded ? 1.5 : focus.length > 0 ? 3 : 2}
                  strokeOpacity={faded ? 0.15 : 1}
                  dot={makeDot(i)}
                  activeDot={faded ? false : { r: 4 }}
                  isAnimationActive={false}
                />
              );
            })}
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
      <div style={{ fontSize: 11, color: "#999", marginTop: 4, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {showPot && <span>- - - ポット</span>}
        {marks.back && rounds.some((r) => r.type === "back") && (
          <span>
            <span style={{ color: "#E63946" }}>●</span> 返された宣言者
          </span>
        )}
        <span>名前をタップで絞り込み</span>
      </div>
    </div>
  );
}

// ============ 次に最初に出す人 ============
export function NextStarter({ players, info, prevRound }) {
  if (!info) return null;
  const names = info.who.map((i) => players[i]).filter(Boolean);
  let main;
  let sub;
  if (info.all) {
    main = "全員でじゃんけん";
    sub = `R${prevRound}は誰も払っていません`;
  } else if (names.length === 1) {
    main = names[0];
    sub = `R${prevRound}で一番多く払った人（${info.amount}点）`;
  } else {
    main = `${names.join("・")}でじゃんけん`;
    sub = `R${prevRound}で同じ${info.amount}点ずつ払った`;
  }
  const single = !info.all && names.length === 1;
  return (
    <div style={{ ...styles.card, display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
      <span style={{ ...styles.miniLabel, whiteSpace: "nowrap" }}>次に始める人</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
        {single && <Dot idx={info.who[0]} size={12} />}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 18, fontWeight: 900 }}>{main}</span>
          <span style={{ display: "block", fontSize: 11, color: "#999" }}>{sub}</span>
        </span>
      </span>
    </div>
  );
}

// ============ 統計 ============
function StatsView({ players, rounds, potEnabled }) {
  const st = useMemo(() => computeStats(players, rounds), [players, rounds]);
  return <StatsBoard players={players} st={st} potEnabled={potEnabled} />;
}

// 統計の表示部分（試合側と閲覧側で共通）。st は computeStats の結果と同じ形
export function StatsBoard({ players, st, potEnabled }) {
  const hasPot = potEnabled || st.draws > 0 || st.potWins.some((v) => v > 0);
  const cats = [
    { key: "declared", label: "宣言回数" },
    { key: "gotBacked", label: "返された" },
    { key: "didBack", label: "返した" },
    { key: "gained", label: "得点合計" },
    { key: "lost", label: "失点合計" },
    ...(hasPot
      ? [
          { key: "potWins", label: "ポット獲得回数" },
          { key: "potGained", label: "ポット獲得点" },
        ]
      : []),
  ];
  const [cat, setCat] = useState("declared");
  const values = st[cat] || st.declared;
  const zero = players.map(() => 0);
  const list = players.map((name, idx) => ({ name, idx, v: (values || zero)[idx] || 0 })).sort((a, b) => b.v - a.v);
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
  const csv = "\uFEFF" + buildCsv(game.players, game.rounds, game.joinedAt || []);
  const filename = `yaniv_${stampOf(new Date(game.startedAt || Date.now()))}.csv`;
  await shareOrDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename, "text/csv");
}

// ============ Result（現在ゲーム・履歴詳細の共通部分） ============
function ResultView({ game, mode = "current", onBackToPlay, onNewGame, onBack, onResume }) {
  const { players, rounds, settings } = game;
  const joinedAt = game.joinedAt || [];
  const cumulative = useMemo(() => computeCumulative(players, rounds, joinedAt), [players, rounds, joinedAt]);
  const [shot, setShot] = useState(null); // { url, file }
  const [shotBusy, setShotBusy] = useState(false);
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
  const allValues = cumulative.series
    .flatMap((s) => [...players.map((p) => s[p]), ...(showPot ? [s["ポット"]] : [])])
    .filter((v) => typeof v === "number");
  const rawMin = Math.min(0, ...allValues);
  const rawMax = Math.max(0, ...allValues);
  const step = niceStep((rawMax - rawMin) / 5);
  const yMin = Math.floor(rawMin / step) * step;
  const yMax = Math.ceil(rawMax / step) * step;
  const yTicks = [];
  for (let v = yMin; v <= yMax; v += step) yTicks.push(v);

  // iPhoneのホーム画面アプリではダウンロードが効かないため、
  // 画像を作ってプレビューを出し、そこから共有シートで保存する
  const saveScreenshot = async () => {
    if (!shareRef.current || shotBusy) return;
    setShotBusy(true);
    const opts = {
      backgroundColor: "#f4f1ea",
      pixelRatio: 2,
      cacheBust: true,
    };
    // 横長の画面でもグラフだけ画面幅に広げているので、画像はスマホと同じ幅で作る
    const el = shareRef.current;
    el.classList.add("no-bleed");
    await new Promise((r) => setTimeout(r, 250));
    try {
      // Safariは1回目の描画が欠けることがあるので、2回描画して2回目を使う
      await toBlob(shareRef.current, opts).catch(() => null);
      const blob = await toBlob(shareRef.current, opts);
      if (!blob) throw new Error("empty");
      const name = `yaniv-result-${Date.now()}.png`;
      const file = new File([blob], name, { type: "image/png" });
      setShot({ url: URL.createObjectURL(blob), file, name });
    } catch {
      alert("画像の作成に失敗しました。もう一度試してください。");
    } finally {
      el.classList.remove("no-bleed");
      setShotBusy(false);
    }
  };

  const closeShot = () => {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
  };

  const shareShot = async () => {
    if (!shot) return;
    try {
      if (navigator.canShare && navigator.canShare({ files: [shot.file] })) {
        await navigator.share({ files: [shot.file] });
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
    }
    const a = document.createElement("a");
    a.href = shot.url;
    a.download = shot.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
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

        <div style={styles.card} className="bleed">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h2 style={{ ...styles.h2, margin: 0 }}>累計点の推移</h2>
            <span style={{ fontSize: 12, color: "#999", fontFamily: "monospace" }}>
              R{replayIdx} / {cumulative.series.length - 1}
            </span>
          </div>
          <ScoreChart
            players={players}
            data={visibleSeries}
            rounds={rounds}
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

        <button onClick={saveScreenshot} style={{ ...styles.primary, opacity: shotBusy ? 0.5 : 1 }}>
          {shotBusy ? "画像を作成中…" : "結果を画像で保存"}
        </button>
        <button onClick={() => exportCsv({ ...game, joinedAt })} style={styles.secondary}>
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
      {shot && (
        <div
          onClick={closeShot}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(20,20,20,0.92)",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px)",
            gap: 12,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, minHeight: 0, overflowY: "auto", borderRadius: 8, background: "#f4f1ea" }}
          >
            <img src={shot.url} alt="結果" style={{ width: "100%", display: "block" }} />
          </div>
          <div onClick={(e) => e.stopPropagation()} style={{ display: "grid", gap: 8 }}>
            <button onClick={shareShot} style={{ ...styles.primary, background: "#fff", color: "#1a1a1a" }}>
              共有・保存（「画像を保存」を選択）
            </button>
            <div style={{ color: "#ddd", fontSize: 12, textAlign: "center" }}>画像を長押しでも保存できます</div>
            <button
              onClick={closeShot}
              style={{ ...styles.secondary, background: "transparent", color: "#fff", boxShadow: "inset 0 0 0 1px #fff", border: "none" }}
            >
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function ResultScreen({ game, onBackToPlay, onNewGame, openHistory, historyCount, liveBar }) {
  return (
    <Shell>
      <Header
        title="RESULT"
        right={
          historyCount > 0 && (
            <button onClick={openHistory} style={styles.headerBtn}>
              履歴 ({historyCount}) →
            </button>
          )
        }
      />
      <p style={styles.sub}>
        {game.rounds.length} rounds / {game.players.length} players · 履歴に保存済み
      </p>
      {liveBar}
      <ResultView game={game} mode="current" onBackToPlay={onBackToPlay} onNewGame={onNewGame} />
    </Shell>
  );
}

// ============ 履歴 ============
function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((start(today) - start(d)) / 86400000);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  const wd = "日月火水木金土"[d.getDay()];
  if (diff === 0) return `今日 · ${md}（${wd}）`;
  if (diff === 1) return `昨日 · ${md}（${wd}）`;
  return `${d.getFullYear() === today.getFullYear() ? "" : d.getFullYear() + "年"}${md}（${wd}）`;
}

function timeLabel(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 全員の累計推移を小さく描く
function Sparkline({ players, series, width = 112, height = 56 }) {
  const vals = series.flatMap((pt) => players.map((p) => pt[p])).filter((v) => typeof v === "number");
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const n = Math.max(1, series.length - 1);
  const X = (i) => 2 + (i / n) * (width - 4);
  const Y = (v) => 3 + (1 - (v - min) / span) * (height - 6);
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", flexShrink: 0 }}>
      <rect width={width} height={height} rx={6} fill="#f7f5ef" />
      <line x1={2} x2={width - 2} y1={Y(0)} y2={Y(0)} stroke="#d4d0c4" strokeDasharray="2 2" />
      {players.map((p, i) => {
        const pts = series
          .map((pt, k) => (typeof pt[p] === "number" ? `${X(k).toFixed(1)},${Y(pt[p]).toFixed(1)}` : null))
          .filter(Boolean);
        if (pts.length < 2) return null;
        return (
          <polyline
            key={i}
            points={pts.join(" ")}
            fill="none"
            stroke={PLAYER_COLORS[i % PLAYER_COLORS.length]}
            strokeWidth={1.6}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

const MEDAL = ["#C9A227", "#9AA0A6", "#B87333"];

function HistoryCard({ h, onSelect, onDelete, footer }) {
  const joinedAt = h.joinedAt || [];
  const cum = useMemo(() => computeCumulative(h.players, h.rounds, joinedAt), [h]);
  const ranked = computeRanked(h.players, cum.totals);
  const backs = h.rounds.filter((r) => r.type === "back").length;
  const draws = h.rounds.filter((r) => r.type === "draw").length;
  const mults = h.rounds.filter((r) => (r.multiplier || 1) > 1).length;
  const maxPot = h.rounds.reduce((m, r) => Math.max(m, r.potAfter || 0), 0);
  const chips = [
    backs > 0 && { label: `返し ${backs}`, color: "#E63946" },
    mults > 0 && { label: `倍マッチ ${mults}`, color: "#F4A261" },
    draws > 0 && { label: `流局 ${draws}`, color: "#6b675c" },
    maxPot > 0 && { label: `最高ポット ${maxPot}`, color: "#1a1a1a" },
  ].filter(Boolean);

  return (
    <div
      onClick={onSelect ? () => onSelect(h.id) : undefined}
      style={{ ...styles.card, padding: 0, overflow: "hidden", cursor: onSelect ? "pointer" : "default", position: "relative" }}
    >
      <div style={{ display: "flex", gap: 14, padding: "14px 16px 12px", alignItems: "stretch" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 12, color: "#999" }}>
            <span style={{ fontWeight: 800, color: "#666", fontFamily: "monospace" }}>{timeLabel(h.finishedAt || h.startedAt)}</span>
            <span>
              {h.players.length}人 · {h.rounds.length}R{h.settings?.potEnabled ? " · ポット" : ""}
            </span>
          </div>
          <div style={{ display: "grid", gap: 3, marginTop: 8 }}>
            {ranked.slice(0, 3).map((r, i) => (
              <div key={r.idx} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    width: i === 0 ? 22 : 18,
                    height: i === 0 ? 22 : 18,
                    borderRadius: "50%",
                    background: MEDAL[i],
                    color: "#fff",
                    fontSize: i === 0 ? 12 : 10,
                    fontWeight: 900,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                <Dot idx={r.idx} size={8} />
                <span
                  style={{
                    fontSize: i === 0 ? 18 : 14,
                    fontWeight: i === 0 ? 900 : 600,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {r.name}
                </span>
                <span
                  style={{
                    marginLeft: "auto",
                    fontFamily: "monospace",
                    fontSize: i === 0 ? 16 : 13,
                    fontWeight: 700,
                    color: r.score > 0 ? "#2A9D8F" : r.score < 0 ? "#E63946" : "#999",
                  }}
                >
                  {r.score > 0 ? `+${r.score}` : r.score}
                </span>
              </div>
            ))}
            {ranked.length > 3 && (
              <div style={{ fontSize: 11, color: "#aaa", paddingLeft: 26 }}>
                ほか {ranked.slice(3).map((r) => r.name).join("・")}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", justifyContent: "space-between" }}>
          <Sparkline players={h.players} series={cum.series} />
          {onSelect && <span style={{ fontSize: 12, color: "#999", fontWeight: 700 }}>詳細 →</span>}
        </div>
      </div>
      {(
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "9px 16px",
            borderTop: "1px solid #f0ede5",
            background: "#fcfbf8",
            flexWrap: "wrap",
          }}
        >
          {chips.length === 0 && <span style={{ fontSize: 11, color: "#bbb" }}>波乱なし</span>}
          {chips.map((c) => (
            <span
              key={c.label}
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: c.color,
                background: "#fff",
                boxShadow: `inset 0 0 0 1px ${c.color}55`,
                borderRadius: 10,
                padding: "2px 8px",
              }}
            >
              {c.label}
            </span>
          ))}
          {footer ? (
            <span style={{ marginLeft: "auto", display: "flex", gap: 14 }} onClick={(e) => e.stopPropagation()}>
              {footer}
            </span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(h.id);
              }}
              style={{ ...styles.linkBtn, marginLeft: "auto", fontSize: 12, color: "#c0392b", padding: "2px 0" }}
            >
              削除
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryListScreen({
  history,
  onBack,
  onSelect,
  onDelete,
  onNewGame,
  trashCount,
  openTrash,
  lastBackupAt,
  onExport,
  onImport,
}) {
  // 通算成績（名前ごと）
  const summary = useMemo(() => {
    const stats = {};
    let rounds = 0;
    history.forEach((h) => {
      rounds += h.rounds.length;
      const cum = computeCumulative(h.players, h.rounds, h.joinedAt || []);
      const ranked = computeRanked(h.players, cum.totals);
      ranked.forEach((r, i) => {
        const s = (stats[r.name] = stats[r.name] || { name: r.name, games: 0, wins: 0, total: 0 });
        s.games++;
        s.total += r.score;
        if (i === 0) s.wins++;
      });
    });
    const list = Object.values(stats).sort((a, b) => b.wins - a.wins || b.total - a.total);
    return { list, rounds };
  }, [history]);

  // 日付ごとにまとめる
  const groups = useMemo(() => {
    const out = [];
    history.forEach((h) => {
      const label = dayLabel(h.finishedAt || h.startedAt);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(h);
      else out.push({ label, items: [h] });
    });
    return out;
  }, [history]);

  return (
    <Shell>
      <Header
        title="HISTORY"
        right={
          <button onClick={onBack} style={styles.headerBtn}>
            ← 戻る
          </button>
        }
      />

      {history.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", padding: "40px 20px" }}>
          <div style={{ fontSize: 36, fontWeight: 900, color: "#e5e2da" }}>0</div>
          <div style={{ fontSize: 15, fontWeight: 700, marginTop: 6 }}>まだ記録がありません</div>
          <div style={{ fontSize: 12, color: "#999", marginTop: 6 }}>「結果を見る」を押した試合がここに残ります</div>
        </div>
      ) : (
        <>
          <div style={{ ...styles.card, background: "#1a1a1a", color: "#f4f1ea", border: "none" }}>
            <div style={{ display: "flex", gap: 18 }}>
              <div>
                <div style={{ ...styles.miniLabel, color: "#8a8577" }}>GAMES</div>
                <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.1 }}>{history.length}</div>
              </div>
              <div>
                <div style={{ ...styles.miniLabel, color: "#8a8577" }}>ROUNDS</div>
                <div style={{ fontSize: 34, fontWeight: 900, lineHeight: 1.1 }}>{summary.rounds}</div>
              </div>
            </div>
            <div style={{ ...styles.miniLabel, color: "#8a8577", marginTop: 14, marginBottom: 8 }}>通算 1位回数</div>
            <div style={{ display: "grid", gap: 6 }}>
              {summary.list.slice(0, 5).map((p, i) => {
                const max = summary.list[0].wins || 1;
                return (
                  <div key={p.name} style={{ display: "grid", gridTemplateColumns: "18px 1fr auto", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 900, color: i < 3 ? MEDAL[i] : "#8a8577" }}>{i + 1}</span>
                    <div style={{ position: "relative", height: 24, display: "flex", alignItems: "center" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: 0,
                          top: 4,
                          bottom: 4,
                          width: `${(p.wins / max) * 100}%`,
                          background: i < 3 ? MEDAL[i] : "#555",
                          opacity: 0.35,
                          borderRadius: 3,
                        }}
                      />
                      <span style={{ position: "relative", paddingLeft: 8, fontSize: 14, fontWeight: 700 }}>{p.name}</span>
                    </div>
                    <span style={{ fontSize: 12, color: "#b9b4a6", fontFamily: "monospace" }}>
                      <strong style={{ color: "#fff", fontSize: 15 }}>{p.wins}</strong> / {p.games}試合
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {groups.map((g) => (
            <div key={g.label} style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  fontWeight: 800,
                  color: "#666",
                  marginTop: 6,
                }}
              >
                {g.label}
                <span style={{ flex: 1, height: 1, background: "#e5e2da" }} />
                <span style={{ fontSize: 11, color: "#aaa", fontWeight: 600 }}>{g.items.length}試合</span>
              </div>
              {g.items.map((h) => (
                <HistoryCard key={h.id} h={h} onSelect={onSelect} onDelete={onDelete} />
              ))}
            </div>
          ))}
        </>
      )}

      {trashCount > 0 && (
        <button onClick={openTrash} style={{ ...styles.homeLink, flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
          <span>
            <span style={{ display: "block", fontSize: 15, fontWeight: 800 }}>最近削除した項目</span>
            <span style={{ fontSize: 11, color: "#999", fontWeight: 600 }}>{TRASH_DAYS}日間は復元できます</span>
          </span>
          <span style={{ fontSize: 14, fontWeight: 800, color: "#666" }}>{trashCount}件 →</span>
        </button>
      )}

      <BackupCard history={history} lastBackupAt={lastBackupAt} onExport={onExport} onImport={onImport} />

      <button onClick={onNewGame} style={styles.newGameFab} aria-label="新規ゲーム">
        <span style={{ fontSize: 26, lineHeight: 1, fontWeight: 300 }}>＋</span>
        <span style={{ fontSize: 10, fontWeight: 800, marginTop: 1 }}>新規</span>
      </button>
    </Shell>
  );
}

function BackupCard({ history, lastBackupAt, onExport, onImport }) {
  const fileRef = useRef(null);
  const since = lastBackupAt
    ? history.filter((h) => new Date(h.finishedAt || h.startedAt).getTime() > new Date(lastBackupAt).getTime()).length
    : history.length;
  let status;
  if (!lastBackupAt) status = history.length ? "まだバックアップしていません" : "記録はまだありません";
  else {
    const days = Math.floor((Date.now() - new Date(lastBackupAt).getTime()) / DAY_MS);
    status = `最終バックアップ：${days === 0 ? "今日" : `${days}日前`}`;
  }
  const warn = history.length > 0 && since > 0;
  return (
    <div style={{ ...styles.card, marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 style={{ ...styles.h2, margin: 0 }}>バックアップ</h2>
        <span style={{ fontSize: 12, color: warn ? "#E03131" : "#999", fontWeight: 700 }}>{status}</span>
      </div>
      <p style={{ fontSize: 12, color: "#666", lineHeight: 1.6, margin: "8px 0 12px" }}>
        記録はこのスマホの中にだけ保存されています。ホーム画面のアイコンを消したり機種変更したりすると消えるので、ときどき書き出して「ファイル」などに保存してください。
        {warn && lastBackupAt && (
          <strong style={{ color: "#E03131" }}> 前回から{since}試合増えています。</strong>
        )}
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button
          onClick={onExport}
          style={{ ...styles.primary, padding: 12, fontSize: 14, opacity: history.length ? 1 : 0.35 }}
          disabled={!history.length}
        >
          書き出す
        </button>
        <button onClick={() => fileRef.current?.click()} style={{ ...styles.secondary, padding: 12, fontSize: 14 }}>
          読み込む
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (f) onImport(f);
        }}
      />
      <div style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>
        読み込みは追加のみで、今ある記録は消えません（同じ試合は重複しません）
      </div>
    </div>
  );
}

function TrashScreen({ trash, onBack, onRestore, onPurge }) {
  const daysLeft = (t) => Math.max(1, Math.ceil((new Date(t.deletedAt).getTime() + TRASH_DAYS * DAY_MS - Date.now()) / DAY_MS));
  return (
    <Shell>
      <Header
        title="TRASH"
        right={
          <button onClick={onBack} style={styles.headerBtn}>
            ← 履歴
          </button>
        }
      />
      <p style={{ ...styles.sub, textTransform: "none", letterSpacing: "0.02em" }}>
        最近削除した項目 · 削除から{TRASH_DAYS}日後に完全に削除されます
      </p>
      {trash.length === 0 ? (
        <div style={{ ...styles.card, textAlign: "center", padding: "40px 20px", color: "#999" }}>
          最近削除した項目はありません
        </div>
      ) : (
        <>
          {trash.map((t) => (
            <div key={t.id} style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 12, color: "#999", fontWeight: 700, paddingLeft: 2 }}>
                {formatDate(t.finishedAt || t.startedAt)}の試合 · あと{daysLeft(t)}日
              </div>
              <HistoryCard
                h={t}
                footer={
                  <>
                    <button
                      onClick={() => onRestore(t.id)}
                      style={{ ...styles.linkBtn, fontSize: 13, color: "#2A9D8F", fontWeight: 800, padding: "2px 0" }}
                    >
                      復元
                    </button>
                    <button
                      onClick={() => onPurge(t.id)}
                      style={{ ...styles.linkBtn, fontSize: 12, color: "#c0392b", padding: "2px 0" }}
                    >
                      完全に削除
                    </button>
                  </>
                }
              />
            </div>
          ))}
          <button onClick={() => onPurge(null)} style={{ ...styles.danger, marginTop: 6 }}>
            すべて完全に削除
          </button>
        </>
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
          <button onClick={onBack} style={styles.headerBtn}>
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
export const styles = {
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
    border: "none",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
    borderRadius: 4,
    background: "#fff",
    fontSize: 16,
    fontWeight: 600,
    color: "#1a1a1a",
  },
  numBtnActive: { background: "#1a1a1a", color: "#fff", boxShadow: "inset 0 0 0 1px #1a1a1a" },
  chip: {
    padding: "8px 12px",
    border: "none",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
    borderRadius: 20,
    background: "#fff",
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a1a",
  },
  chipActive: { background: "#1a1a1a", color: "#fff", boxShadow: "inset 0 0 0 1px #1a1a1a" },
  typeBtn: {
    padding: "14px 2px",
    border: "none",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
    borderRadius: 6,
    background: "#fff",
    fontSize: 13,
    fontWeight: 800,
    whiteSpace: "nowrap",
    color: "#1a1a1a",
  },
  typeBtnActive: { background: "#1a1a1a", color: "#fff", boxShadow: "inset 0 0 0 1px #1a1a1a" },
  stepBtn: {
    width: 40,
    height: 40,
    border: "none",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
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
    border: "none",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
    background: "#fff",
    borderRadius: 4,
    fontSize: 16,
    color: "#999",
  },
  toast: {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 92px)",
    zIndex: 70,
    background: "#1a1a1a",
    color: "#fff",
    borderRadius: 12,
    padding: "12px 16px",
    fontSize: 14,
    fontWeight: 600,
    display: "flex",
    alignItems: "center",
    gap: 16,
    boxShadow: "0 6px 20px rgba(0,0,0,0.3)",
    width: "max-content",
    maxWidth: "calc(100% - 32px)",
  },
  newGameFab: {
    position: "fixed",
    left: 16,
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
    zIndex: 40,
    width: 64,
    height: 64,
    borderRadius: "50%",
    border: "none",
    background: "#E63946",
    color: "#fff",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 6px 16px rgba(230,57,70,0.4)",
  },
  homeLink: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    padding: "14px 16px",
    border: "none",
    borderRadius: 10,
    background: "#fff",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
    color: "#1a1a1a",
    textAlign: "left",
  },
  linkBtn: { background: "none", border: "none", color: "#666", fontSize: 14, fontWeight: 600, padding: "6px 0" },
  headerBtn: {
    background: "#fff",
    border: "none",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
    color: "#1a1a1a",
    fontSize: 15,
    fontWeight: 700,
    padding: "10px 14px",
    borderRadius: 20,
    minHeight: 42,
  },
  miniChip: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "5px 9px",
    border: "none",
    boxShadow: "inset 0 0 0 1px #d4d0c4",
    borderRadius: 14,
    background: "#fff",
    fontSize: 12,
    fontWeight: 600,
    color: "#1a1a1a",
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
