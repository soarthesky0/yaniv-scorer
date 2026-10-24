import React, { useMemo, useState } from "react";
import { Shell, Header, Dot, PlayScreen, ResultView, Segmented, Toggle, NameChips, styles } from "./App.jsx";
import { recommendFor } from "./RulesPages.jsx";
import {
  TABLE_IDS,
  newId,
  makeEvent,
  inputFromRecord,
  currentBlock,
  sessionGame,
  sessionTotals,
  autoAssign,
  tableSizes,
} from "./session.js";

const RED = "#E63946";
const GREEN = "#14953F";
const AMBER = "#C99100";
const isPlaceholder = (v) => !v || !v.trim() || /^P\d+$/.test(v.trim());

function defaultTableCount(n) {
  if (n <= 6) return 1;
  if (n <= 11) return 2;
  return 3;
}

// ============ 割り振り画面 ============
// S: 今のセッション（新規なら null）
export function SessionAssign({ S, draftNames = [], knownNames = [], lastMembers, onStart, onCancel, onEnd, onResult }) {
  const totals = useMemo(() => (S ? sessionTotals(S) : []), [S]);
  const totalOf = (id) => (totals.find((t) => t.id === id) || {}).total || 0;
  const lastBlock = S ? currentBlock(S) : null;
  const blockNo = S ? S.blocks.length + 1 : 1;

  // 名簿：既存の名簿＋この画面で足した人。present=false は今回休み
  const [people, setPeople] = useState(() => {
    if (S) {
      const playing = new Set(lastBlock ? lastBlock.tables.flatMap((t) => t.pids) : S.roster.map((r) => r.id));
      return S.roster.map((r) => ({ id: r.id, name: r.name, present: playing.has(r.id), isNew: false }));
    }
    return draftNames.filter((n) => !isPlaceholder(n)).map((name) => ({ id: newId(8), name, present: true, isNew: true }));
  });
  const present = people.filter((p) => p.present);
  // 卓の数：手で選ぶまでは参加人数から自動で決める
  const [tableCountManual, setTableCount] = useState(null);
  const tableCount = Math.min(3, Math.max(1, tableCountManual ?? defaultTableCount(present.length)));
  const [assign, setAssign] = useState(() => ({})); // id -> 卓の番号
  const [tableSet, setTableSet] = useState({}); // 卓の番号 -> {declareLine, deckCount}（手で変えた分）
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState("");
  const [blockLength, setBlockLength] = useState(S ? S.settings.blockLength || 10 : 10);
  const [potEnabled, setPotEnabled] = useState(S ? !!S.settings.potEnabled : true);

  // 割り振りが決まっていない人は、空いている卓に入れる
  const effective = useMemo(() => {
    const out = {};
    const count = Array(tableCount).fill(0);
    present.forEach((p) => {
      const a = assign[p.id];
      if (a !== undefined && a < tableCount) {
        out[p.id] = a;
        count[a]++;
      }
    });
    const sizes = tableSizes(present.length, tableCount);
    present.forEach((p) => {
      if (out[p.id] !== undefined) return;
      let ti = count.findIndex((c, i) => c < sizes[i]);
      if (ti < 0) ti = count.indexOf(Math.min(...count));
      out[p.id] = ti;
      count[ti]++;
    });
    return out;
  }, [assign, present, tableCount]);

  const tables = Array.from({ length: tableCount }, (_, ti) => {
    const members = present.filter((p) => effective[p.id] === ti);
    const rec = recommendFor(members.length);
    return { ti, id: TABLE_IDS[ti], members, set: { ...rec, ...(tableSet[ti] || {}) }, rec };
  });

  const addPerson = (name) => {
    const nm = (name || "").trim();
    if (!nm) return;
    if (people.some((p) => p.name === nm)) {
      setPeople((prev) => prev.map((p) => (p.name === nm ? { ...p, present: true } : p)));
    } else {
      setPeople((prev) => [...prev, { id: newId(8), name: nm, present: true, isNew: true }]);
    }
    setNewName("");
  };
  const togglePresent = (id) => setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, present: !p.present } : p)));
  const removeNew = (id) => setPeople((prev) => prev.filter((p) => p.id !== id));

  const runAuto = (mode) => {
    const groups = autoAssign(
      present.map((p) => ({ id: p.id, total: totalOf(p.id) })),
      tableCount,
      mode
    );
    const next = {};
    groups.forEach((ids, ti) => ids.forEach((id) => (next[id] = ti)));
    setAssign(next);
    setSelected(null);
  };

  const moveTo = (ti) => {
    if (!selected) return;
    setAssign((prev) => ({ ...effective, ...prev, [selected]: ti }));
    setSelected(null);
  };

  const canStart = tables.every((t) => t.members.length >= 2) && present.length >= 2;

  const start = () => {
    if (!canStart) return;
    onStart({
      addRoster: people.filter((p) => p.isNew && p.present).map((p) => ({ id: p.id, name: p.name })),
      tables: tables.map((t) => ({
        id: t.id,
        pids: t.members.map((m) => m.id),
        set: { declareLine: t.set.declareLine, deckCount: t.set.deckCount },
      })),
      settings: { blockLength, potEnabled },
    });
  };

  const suggestions = knownNames.filter((n) => !people.some((p) => p.name === n));
  const canUseLast =
    !S && lastMembers && lastMembers.length >= 2 && lastMembers.some((n) => !people.some((p) => p.name === n));

  return (
    <Shell>
      <Header
        title="複数卓"
        right={
          <button onClick={onCancel} style={styles.headerBtn}>
            {S && S.blocks.length ? "← 戻る" : "やめる"}
          </button>
        }
      />
      <p style={{ ...styles.sub, textTransform: "none", letterSpacing: "0.04em" }}>
        区切り{blockNo}の割り振り{S && S.blocks.length ? ` · ${S.roster.length}人のセッション` : ""}
      </p>

      {/* 参加者 */}
      <div style={styles.card}>
        <h2 style={styles.h2}>参加者（{present.length}人）</h2>
        {canUseLast && (
          <button
            onClick={() => lastMembers.forEach(addPerson)}
            style={{ ...styles.secondary, marginBottom: 12, textAlign: "left" }}
          >
            前回のメンバーを入れる：{lastMembers.join("・")}
          </button>
        )}
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => togglePresent(p.id)}
              style={{
                ...styles.chip,
                ...(p.present ? styles.chipActive : { color: "#aaa", textDecoration: "line-through" }),
              }}
            >
              {p.name}
              {S && !p.isNew && <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 12 }}>{fmt(totalOf(p.id))}</span>}
            </button>
          ))}
        </div>
        {people.length > 0 && (
          <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>名前をタップで「今回は休み」に切り替え</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addPerson(newName)}
            placeholder="参加者を追加"
            style={styles.input}
          />
          <button onClick={() => addPerson(newName)} style={{ ...styles.headerBtn, background: "#1a1a1a", color: "#fff" }}>
            追加
          </button>
        </div>
        {suggestions.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <NameChips names={suggestions} onPick={addPerson} />
          </div>
        )}
        {people.some((p) => p.isNew) && S && (
          <div style={{ fontSize: 11, color: "#999", marginTop: 8 }}>新しく加わる人は持ち点0から始まります</div>
        )}
      </div>

      {lastBlock && !lastBlock.closed && lastBlock.tables.some((t) => (t.rounds[t.rounds.length - 1]?.potAfter || 0) > 0) && (
        <div style={{ ...styles.card, background: "#fff8e6", border: "none", boxShadow: `inset 0 0 0 1px ${AMBER}`, fontSize: 13, lineHeight: 1.6 }}>
          区切り{lastBlock.no}のポットの残り（
          {lastBlock.tables
            .map((t) => ({ t, pot: t.rounds[t.rounds.length - 1]?.potAfter || 0 }))
            .filter((x) => x.pot > 0)
            .map((x) => `${lastBlock.multi ? `卓${x.t.id} ` : ""}${x.pot}点`)
            .join("、")}
          ）は、区切り{blockNo}を始めるときに入れた人へ返金されます
        </div>
      )}

      {/* 卓 */}
      <div style={styles.card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <h2 style={{ ...styles.h2, margin: 0 }}>卓の数</h2>
          <Segmented
            small
            value={tableCount}
            onChange={(v) => {
              setTableCount(v);
              setSelected(null);
            }}
            options={[1, 2, 3].map((v) => ({ value: v, label: `${v}卓` }))}
          />
        </div>
        {tableCount > 1 && (
          <>
            <div style={{ fontSize: 12, color: "#666", marginTop: 14, marginBottom: 6 }}>自動で割り振る</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <button onClick={() => runAuto("random")} style={styles.autoBtn}>
                ランダム
              </button>
              <button onClick={() => runAuto("mix")} style={styles.autoBtn}>
                上位と下位を混ぜる
              </button>
              <button onClick={() => runAuto("near")} style={styles.autoBtn}>
                点が近い人同士
              </button>
            </div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 6 }}>
              人をタップしてから、移したい卓の「ここに移す」をタップ
            </div>
          </>
        )}
      </div>

      {tables.map((t) => (
        <div key={t.ti} style={{ ...styles.card, ...(selected && effective[selected] !== t.ti ? { boxShadow: "inset 0 0 0 2px #1a1a1a" } : {}) }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ ...styles.h2, margin: 0, fontSize: 16, color: "#1a1a1a" }}>
              {tableCount > 1 ? `卓${t.id}` : "1卓"}
              <span style={{ fontSize: 12, color: "#999", fontWeight: 600, marginLeft: 8 }}>{t.members.length}人</span>
            </h2>
            {selected && effective[selected] !== t.ti && (
              <button onClick={() => moveTo(t.ti)} style={{ ...styles.headerBtn, background: "#1a1a1a", color: "#fff", minHeight: 34, padding: "6px 12px", fontSize: 13 }}>
                ここに移す
              </button>
            )}
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, minHeight: 38 }}>
            {t.members.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(selected === m.id ? null : m.id)}
                disabled={tableCount === 1}
                style={{
                  ...styles.chip,
                  ...(selected === m.id ? styles.chipActive : {}),
                }}
              >
                {m.name}
                {S && !m.isNew && (
                  <span style={{ opacity: 0.6, marginLeft: 6, fontSize: 12 }}>{fmt(totalOf(m.id))}</span>
                )}
              </button>
            ))}
            {t.members.length < 2 && <span style={{ fontSize: 12, color: RED, alignSelf: "center" }}>2人以上必要です</span>}
          </div>
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
            <MiniStepper
              label="宣言ライン"
              value={t.set.declareLine}
              suffix="点"
              onChange={(v) => setTableSet((prev) => ({ ...prev, [t.ti]: { ...(prev[t.ti] || {}), declareLine: v } }))}
            />
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, color: "#666" }}>デッキ</span>
              <Segmented
                small
                value={t.set.deckCount}
                onChange={(v) => setTableSet((prev) => ({ ...prev, [t.ti]: { ...(prev[t.ti] || {}), deckCount: v } }))}
                options={[
                  { value: 1, label: "1" },
                  { value: 2, label: "2" },
                ]}
              />
            </span>
          </div>
        </div>
      ))}

      {/* 共通設定（最初だけ・変更もここで） */}
      <div style={styles.card}>
        <h2 style={styles.h2}>共通の設定</h2>
        <div style={{ display: "grid", gap: 14 }}>
          <MiniStepper
            label="区切りの長さ（最後のラウンドが倍マッチ）"
            value={blockLength}
            suffix="ラウンド"
            min={1}
            onChange={setBlockLength}
          />
          <Toggle label="流局ポット" value={potEnabled} onChange={setPotEnabled} note="区切りの終わりに残ったポットは、入れた人に返金" />
        </div>
        {tableCount === 1 && (
          <div style={{ fontSize: 11, color: "#999", marginTop: 10 }}>
            1卓の区切りは、いつもの試合と同じく倍マッチの周期（設定）で進みます
          </div>
        )}
      </div>

      <button onClick={start} disabled={!canStart} style={{ ...styles.primary, opacity: canStart ? 1 : 0.35 }}>
        区切り{blockNo}を始める →
      </button>

      {S && S.blocks.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <button onClick={onResult} style={styles.secondary}>
            ここまでの結果
          </button>
          <button onClick={onEnd} style={styles.danger}>
            セッションを終える
          </button>
        </div>
      )}
    </Shell>
  );
}

function fmt(v) {
  return v > 0 ? `+${v}` : `${v}`;
}

function MiniStepper({ label, value, onChange, suffix = "", min = 0 }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 12, color: "#666" }}>{label}</span>
      <button style={styles.miniStep} onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <span style={{ fontSize: 15, fontWeight: 800, minWidth: 28, textAlign: "center" }}>
        {value}
        <span style={{ fontSize: 11, fontWeight: 600 }}>{suffix}</span>
      </span>
      <button style={styles.miniStep} onClick={() => onChange(value + 1)}>
        ＋
      </button>
    </span>
  );
}

// ============ 卓の入力画面 ============
export function SessionPlay({ S, tableId, setTableId, emit, onResult, onAssignNext, onEnd, liveBar, readOnlyTables = [] }) {
  const block = currentBlock(S);
  const multi = block.multi;
  const table = block.tables.find((t) => t.id === tableId) || block.tables[0];
  const nameOf = useMemo(() => {
    const m = {};
    S.roster.forEach((r) => (m[r.id] = r.name));
    return m;
  }, [S.roster]);
  const totals = useMemo(() => sessionTotals(S), [S]);
  const [showAll, setShowAll] = useState(false);

  const settings = {
    ...S.settings,
    ...table.set,
    doublePeriod: multi ? S.settings.blockLength || 10 : S.settings.doublePeriod,
  };
  const game = {
    players: table.pids.map((id) => nameOf[id]),
    rounds: table.rounds.filter((r) => r.type !== "refund"),
    settings,
    doubleLog: table.doubleLog,
    joinedAt: table.pids.map(() => 0),
    doubleOnce: multi,
    phase: "play",
  };

  // 試合画面からの変更をセッションの出来事に置き換える
  const updateCurrent = (patchOrFn) => {
    const patch = typeof patchOrFn === "function" ? patchOrFn(game) : patchOrFn;
    const evs = [];
    if (patch.rounds) {
      const old = game.rounds;
      if (patch.rounds.length === old.length + 1) {
        const rec = patch.rounds[patch.rounds.length - 1];
        const n = (old.length ? old[old.length - 1].n : 0) + 1;
        evs.push(makeEvent("r", { b: block.no, t: table.id, n, in: inputFromRecord(rec, settings) }));
      } else if (patch.rounds.length === old.length - 1 && old.length) {
        evs.push(makeEvent("u", { b: block.no, t: table.id, n: old[old.length - 1].n }));
      }
    }
    if (patch.doubleLog && JSON.stringify(patch.doubleLog) !== JSON.stringify(game.doubleLog)) {
      evs.push(makeEvent("dbl", { b: block.no, t: table.id, log: patch.doubleLog }));
    }
    if (evs.length) emit(...evs);
  };
  const updateSettings = (patch) => {
    const tpatch = {};
    const spatch = {};
    Object.entries(patch).forEach(([k, v]) => {
      if (k === "declareLine" || k === "deckCount") tpatch[k] = v;
      else spatch[k] = v;
    });
    const evs = [];
    if (Object.keys(tpatch).length) evs.push(makeEvent("tset", { b: block.no, t: table.id, patch: tpatch }));
    if (Object.keys(spatch).length) evs.push(makeEvent("settings", { patch: spatch }));
    if (evs.length) emit(...evs);
  };

  const ranked = totals.slice().sort((a, b) => b.total - a.total);
  const others = block.tables.filter((t) => t.id !== table.id);

  const top = (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#888", fontWeight: 700 }}>
        <span style={{ background: "#1a1a1a", color: "#fff", borderRadius: 10, padding: "2px 9px" }}>複数卓セッション</span>
        区切り{block.no}
        {multi && ` · ${S.settings.blockLength || 10}ラウンド`}
      </div>
      {multi && (
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${block.tables.length}, 1fr)`, gap: 6 }}>
          {block.tables.map((t) => {
            const on = t.id === table.id;
            return (
              <button
                key={t.id}
                onClick={() => setTableId(t.id)}
                style={{
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 6px",
                  background: on ? "#1a1a1a" : "#fff",
                  color: on ? "#fff" : "#1a1a1a",
                  boxShadow: on ? "none" : "inset 0 0 0 1px #d4d0c4",
                  textAlign: "center",
                }}
              >
                <div style={{ fontSize: 16, fontWeight: 900 }}>
                  卓{t.id}
                  {readOnlyTables.includes(t.id) && <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.7 }}>閲覧</span>}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: t.status.done ? (on ? "#9be3ae" : GREEN) : on ? "#ccc" : "#888" }}>
                  {t.status.done ? `区切り済 · R${t.status.played}` : `R${t.status.played}／${t.status.doubleRound}`}
                </div>
              </button>
            );
          })}
        </div>
      )}
      <div style={{ ...styles.card, padding: "10px 14px" }}>
        <button
          onClick={() => setShowAll(!showAll)}
          style={{ ...styles.linkBtn, width: "100%", display: "flex", justifyContent: "space-between", color: "#1a1a1a" }}
        >
          <span style={{ fontSize: 13, fontWeight: 800 }}>全体の順位</span>
          <span style={{ fontSize: 12, color: "#888" }}>
            {!showAll && ranked[0] ? `1位 ${ranked[0].name} ${fmt(ranked[0].total)}　` : ""}
            {showAll ? "▼ 閉じる" : "▶ 全員"}
          </span>
        </button>
        {showAll && (
          <div style={{ display: "grid", gap: 4, marginTop: 8 }}>
            {ranked.map((p, i) => {
              const where = block.tables.find((t) => t.pids.includes(p.id));
              return (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
                  <span style={{ width: 18, color: "#999", fontWeight: 800, fontSize: 12 }}>{i + 1}</span>
                  <span style={{ flex: 1 }}>{p.name}</span>
                  <span style={{ fontSize: 11, color: "#999" }}>{where ? (multi ? `卓${where.id}` : "") : "休み"}</span>
                  <span style={{ fontFamily: "monospace", fontWeight: 800, minWidth: 48, textAlign: "right" }}>{p.total}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  let banner = null;
  if (multi && block.allDone) {
    banner = (
      <div style={{ ...styles.card, background: "#1a1a1a", color: "#fff", border: "none" }}>
        <div style={{ fontSize: 20, fontWeight: 900 }}>区切り{block.no} 終了</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>
          全卓が倍マッチを終えました。今のラウンドを入力したら、全体の点を見て次の割り振りへ。
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
          <button onClick={onAssignNext} style={{ ...styles.primary, background: "#fff", color: "#1a1a1a", padding: 12 }}>
            次の割り振りへ
          </button>
          <button onClick={onResult} style={{ ...styles.secondary, background: "transparent", color: "#fff", boxShadow: "inset 0 0 0 1px #fff", border: "none" }}>
            ここまでの結果
          </button>
        </div>
      </div>
    );
  } else if (multi && table.status.done) {
    const waiting = others.filter((t) => !t.status.done);
    banner = (
      <div style={{ ...styles.card, background: "#fff8e6", border: "none", boxShadow: `inset 0 0 0 2px ${AMBER}` }}>
        <div style={{ fontSize: 16, fontWeight: 900, color: "#8a6400" }}>この卓は区切り{block.no}の倍マッチを終えました</div>
        <div style={{ fontSize: 13, color: "#6b5200", marginTop: 4, lineHeight: 1.6 }}>
          他の卓が終わるまで、普通のラウンドを続けてください（
          {waiting.map((t) => `卓${t.id}：R${t.status.played}／${t.status.doubleRound}`).join("、")}）
        </div>
      </div>
    );
  }

  const settingsExtra = (close) => (
    <div style={{ display: "grid", gap: 10 }}>
      <button
        onClick={() => {
          if (multi && !block.allDone && !confirm("まだ倍マッチを終えていない卓があります。区切りを終えて割り振り直す？")) return;
          close();
          onAssignNext();
        }}
        style={styles.secondary}
      >
        区切りを終えて割り振り直す
      </button>
      <button
        onClick={() => {
          close();
          onEnd();
        }}
        style={styles.danger}
      >
        セッションを終える
      </button>
    </div>
  );

  return (
    <PlayScreen
      key={`${block.no}-${table.id}`}
      game={game}
      updateCurrent={updateCurrent}
      updateSettings={updateSettings}
      goResult={onResult}
      liveBar={liveBar}
      sessionUi={{
        top,
        banner,
        totalsTitle: multi ? `卓${table.id}の点（区切り${block.no}）` : `この区切りの点（区切り${block.no}）`,
        resultLabel: "セッションの結果 →",
        settingsExtra,
        headerRight: null,
      }}
    />
  );
}

// ============ セッションの結果 ============
export function SessionResult({ S, onBack, onEnd, liveBar, ended, onBackToHistory, onResume }) {
  const game = useMemo(() => sessionGame(S), [S]);
  return (
    <Shell>
      <Header
        title="RESULT"
        right={
          <button onClick={ended ? onBackToHistory : onBack} style={styles.headerBtn}>
            ← {ended ? "履歴" : "戻る"}
          </button>
        }
      />
      <p style={{ ...styles.sub, textTransform: "none", letterSpacing: "0.04em" }}>
        複数卓セッション · {S.blocks.length}区切り · {S.roster.length}人 · {game.rounds.filter((r) => r.type !== "refund").length}ラウンド
      </p>
      {liveBar}
      <ResultView
        game={game}
        mode={ended ? "history" : "current"}
        onBackToPlay={onBack}
        onNewGame={onEnd}
        onBack={onBackToHistory}
        onResume={onResume}
        labels={{ back: "← セッションに戻る（続行）", newGame: "セッションを終える", resume: "▶ このセッションを再開する" }}
      />
    </Shell>
  );
}
