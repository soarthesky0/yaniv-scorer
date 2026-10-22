import React, { useState, useId } from "react";

// ============ 人数別のおすすめ ============
export function recommendFor(n) {
  if (n >= 6) return { deckCount: 2, declareLine: 5 };
  if (n === 5) return { deckCount: 1, declareLine: 7 };
  return { deckCount: 1, declareLine: 5 };
}

const C = {
  ink: "#1a1a1a",
  sub: "#666",
  faint: "#999",
  line: "#e5e2da",
  paper: "#f4f1ea",
  red: "#E63946",
  green: "#2A9D8F",
  navy: "#1D3557",
  amber: "#F4A261",
  purple: "#9D4EDD",
};

// ============ カードの図 ============
const RED_SUITS = ["♥", "♦"];

function Card({ x, y, rank, suit, w = 40, h = 56, joker, back, dim }) {
  if (back) {
    return (
      <g transform={`translate(${x},${y})`}>
        <rect width={w} height={h} rx={5} fill={C.navy} stroke="#fff" strokeWidth={1.5} />
        <rect x={4} y={4} width={w - 8} height={h - 8} rx={3} fill="none" stroke="rgba(255,255,255,0.35)" />
      </g>
    );
  }
  const color = joker ? C.purple : RED_SUITS.includes(suit) ? C.red : C.ink;
  return (
    <g transform={`translate(${x},${y})`} opacity={dim ? 0.45 : 1}>
      <rect width={w} height={h} rx={5} fill="#fff" stroke="#b9b4a6" strokeWidth={1.2} />
      {joker ? (
        <>
          <text x={w / 2} y={15} fontSize={8} fontWeight={800} fill={color} textAnchor="middle" letterSpacing="0.5">
            JOKER
          </text>
          <text x={w / 2} y={h / 2 + 12} fontSize={22} fill={color} textAnchor="middle">
            ★
          </text>
        </>
      ) : (
        <>
          <text x={5} y={14} fontSize={12} fontWeight={800} fill={color}>
            {rank}
          </text>
          <text x={w / 2} y={h / 2 + 11} fontSize={22} fill={color} textAnchor="middle">
            {suit}
          </text>
        </>
      )}
    </g>
  );
}

function ArrowDefs({ id, color = C.ink }) {
  return (
    <defs>
      <marker id={id} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill={color} />
      </marker>
    </defs>
  );
}

function Figure({ children, height, caption }) {
  return (
    <figure style={{ margin: "12px 0 4px" }}>
      <svg
        viewBox={`0 0 340 ${height}`}
        style={{ width: "100%", height: "auto", display: "block", background: C.paper, borderRadius: 8 }}
        fontFamily="-apple-system, 'Hiragino Sans', sans-serif"
      >
        {children}
      </svg>
      {caption && (
        <figcaption style={{ fontSize: 12, color: C.faint, marginTop: 6, lineHeight: 1.5 }}>{caption}</figcaption>
      )}
    </figure>
  );
}

function CardPointsFigure() {
  const cards = [
    { rank: "A", suit: "♠", pt: "1点" },
    { rank: "10", suit: "♥", pt: "10点" },
    { rank: "K", suit: "♣", pt: "13点" },
    { joker: true, pt: "0点" },
  ];
  return (
    <Figure height={110}>
      {cards.map((c, i) => {
        const x = 30 + i * 75;
        return (
          <g key={i}>
            <Card x={x} y={14} {...c} />
            <text x={x + 20} y={95} fontSize={15} fontWeight={800} textAnchor="middle" fill={c.joker ? C.purple : C.ink}>
              {c.pt}
            </text>
          </g>
        );
      })}
    </Figure>
  );
}

function SetsFigure() {
  return (
    <Figure height={128} caption="★（ジョーカー）は5の代わりになって 4・5・6 の連番になる">
      <text x={40} y={20} fontSize={12} fontWeight={700} fill={C.sub} textAnchor="middle">
        1枚
      </text>
      <Card x={20} y={30} rank="7" suit="♦" />

      <text x={126} y={20} fontSize={12} fontWeight={700} fill={C.sub} textAnchor="middle">
        同じ数字
      </text>
      <Card x={84} y={30} rank="8" suit="♠" />
      <Card x={128} y={30} rank="8" suit="♥" />

      <text x={256} y={20} fontSize={12} fontWeight={700} fill={C.sub} textAnchor="middle">
        連番（同じマーク）
      </text>
      <Card x={192} y={30} rank="4" suit="♥" />
      <Card x={236} y={30} joker />
      <Card x={280} y={30} rank="6" suit="♥" />
      <text x={256} y={106} fontSize={11} fill={C.purple} textAnchor="middle" fontWeight={700}>
        ★＝5の代わり
      </text>
      <line x1={72} y1={30} x2={72} y2={86} stroke={C.line} strokeWidth={1.5} strokeDasharray="3 3" />
      <line x1={180} y1={30} x2={180} y2={86} stroke={C.line} strokeWidth={1.5} strokeDasharray="3 3" />
    </Figure>
  );
}

function DrawFigure() {
  const id = useId().replace(/:/g, "");
  return (
    <Figure height={170} caption="直前の人が4・5・6・7を出したら、取れるのは端の4か7だけ。山札なら一番上の1枚。">
      <ArrowDefs id={`ok${id}`} color={C.green} />
      <text x={45} y={20} fontSize={12} fontWeight={700} fill={C.sub} textAnchor="middle">
        山札
      </text>
      <Card x={29} y={38} back />
      <Card x={27} y={34} back />
      <Card x={25} y={30} back />
      <path d="M45 128 L45 92" stroke={C.green} strokeWidth={2} markerEnd={`url(#ok${id})`} />
      <text x={45} y={146} fontSize={12} fontWeight={800} fill={C.green} textAnchor="middle">
        一番上
      </text>

      <line x1={98} y1={20} x2={98} y2={150} stroke={C.line} strokeWidth={1.5} strokeDasharray="4 4" />

      <text x={217} y={20} fontSize={12} fontWeight={700} fill={C.sub} textAnchor="middle">
        捨札（直前の人が出した組）
      </text>
      {["4", "5", "6", "7"].map((r, i) => (
        <Card key={r} x={130 + i * 46} y={30} rank={r} suit="♣" dim={i === 1 || i === 2} />
      ))}
      {[0, 3].map((i) => (
        <g key={i}>
          <path d={`M${150 + i * 46} 128 L${150 + i * 46} 92`} stroke={C.green} strokeWidth={2} markerEnd={`url(#ok${id})`} />
          <text x={150 + i * 46} y={146} fontSize={13} fontWeight={800} fill={C.green} textAnchor="middle">
            ○
          </text>
        </g>
      ))}
      {[1, 2].map((i) => (
        <text key={i} x={150 + i * 46} y={116} fontSize={18} fontWeight={800} fill={C.red} textAnchor="middle">
          ✕
        </text>
      ))}
    </Figure>
  );
}

// プレイヤーの手札合計と点の移動
function FlowFigure({ players, arrows, height = 150, caption }) {
  const id = useId().replace(/:/g, "");
  const n = players.length;
  const bw = Math.min(70, (320 - (n - 1) * 8) / n);
  const total = n * bw + (n - 1) * 8;
  const x0 = (340 - total) / 2;
  const cx = (i) => x0 + i * (bw + 8) + bw / 2;
  const top = 70;
  return (
    <Figure height={height} caption={caption}>
      <ArrowDefs id={`a${id}`} color={C.red} />
      {arrows.map((a, k) => {
        const x1 = cx(a.from);
        const x2 = cx(a.to);
        const lift = 26 + Math.abs(a.from - a.to) * 9 + k * 4;
        const mid = (x1 + x2) / 2;
        return (
          <g key={k}>
            <path
              d={`M${x1} ${top - 4} Q ${mid} ${top - 4 - lift * 1.6} ${x2 + (x2 > x1 ? -4 : 4)} ${top - 6}`}
              fill="none"
              stroke={C.red}
              strokeWidth={2.2}
              markerEnd={`url(#a${id})`}
            />
            <rect x={mid - 26} y={top - 4 - lift * 0.8 - 12} width={52} height={20} rx={10} fill="#fff" stroke={C.red} />
            <text x={mid} y={top - 4 - lift * 0.8 + 3} fontSize={12} fontWeight={800} fill={C.red} textAnchor="middle">
              {a.label}
            </text>
          </g>
        );
      })}
      {players.map((p, i) => {
        const x = x0 + i * (bw + 8);
        const tagColor = p.role === "宣言" ? C.navy : p.role ? C.red : null;
        return (
          <g key={i}>
            <rect x={x} y={top} width={bw} height={56} rx={8} fill="#fff" stroke={tagColor || "#cfc9bb"} strokeWidth={tagColor ? 2 : 1} />
            <text x={x + bw / 2} y={top + 17} fontSize={12} fontWeight={700} fill={C.sub} textAnchor="middle">
              {p.name}
            </text>
            <text x={x + bw / 2} y={top + 42} fontSize={19} fontWeight={900} fill={C.ink} textAnchor="middle">
              {p.total}
            </text>
            {p.role && (
              <text x={x + bw / 2} y={top + 74} fontSize={11} fontWeight={800} fill={tagColor} textAnchor="middle">
                {p.role}
              </text>
            )}
          </g>
        );
      })}
    </Figure>
  );
}

export const POT_EXAMPLE_HANDS = [12, 8, 20, 5, 15];
export const potPay = (hand, line) => Math.max(0, hand - line);

function PotFigure({ line }) {
  const id = useId().replace(/:/g, "");
  const hands = POT_EXAMPLE_HANDS;
  const pays = hands.map((h) => potPay(h, line));
  const total = pays.reduce((a, b) => a + b, 0);
  const names = ["A", "B", "C", "D", "E"];
  const bw = 54;
  const x0 = (340 - (5 * bw + 4 * 8)) / 2;
  return (
    <Figure
      height={282}
      caption={`手札合計から宣言ライン${line}点を引いた分だけ払う（${line}点以下の人は0点）。流局のたびにポットが積み上がり、次にヤニブが成功した人（返しなら返した人）が総取りする`}
    >
      <ArrowDefs id={`p${id}`} color={C.ink} />
      <text x={170} y={18} fontSize={12} fontWeight={700} fill={C.sub} textAnchor="middle">
        流局 → 各自「手札合計−{line}」をポットへ
      </text>
      {hands.map((h, i) => {
        const x = x0 + i * (bw + 8);
        const pay = pays[i];
        return (
          <g key={i}>
            <rect x={x} y={30} width={bw} height={60} rx={8} fill="#fff" stroke="#cfc9bb" />
            <text x={x + bw / 2} y={45} fontSize={11} fontWeight={700} fill={C.sub} textAnchor="middle">
              {names[i]}
            </text>
            <text x={x + bw / 2} y={60} fontSize={10} fill={C.faint} textAnchor="middle">
              手札{h}
            </text>
            <text
              x={x + bw / 2}
              y={81}
              fontSize={16}
              fontWeight={900}
              fill={pay > 0 ? C.red : C.faint}
              textAnchor="middle"
            >
              {pay > 0 ? `−${pay}` : "0"}
            </text>
            {pay > 0 && (
              <path
                d={`M${x + bw / 2} 94 Q ${x + bw / 2} 116 ${170 + (i - 2) * 10} 128`}
                fill="none"
                stroke={C.ink}
                strokeWidth={1.5}
                markerEnd={`url(#p${id})`}
              />
            )}
          </g>
        );
      })}
      <rect x={110} y={132} width={120} height={50} rx={25} fill={C.ink} />
      <text x={170} y={152} fontSize={11} fontWeight={700} fill="#b9b4a6" textAnchor="middle">
        POT
      </text>
      <text x={170} y={173} fontSize={20} fontWeight={900} fill="#fff" textAnchor="middle">
        {total}
      </text>
      <path d="M170 186 L170 216" stroke={C.ink} strokeWidth={2} markerEnd={`url(#p${id})`} />
      <text x={186} y={206} fontSize={11} fill={C.sub}>
        次のラウンドへ持ち越し
      </text>
      <rect x={60} y={222} width={220} height={40} rx={8} fill="#fff" stroke={C.green} strokeWidth={2} />
      <text x={170} y={247} fontSize={13} fontWeight={800} fill={C.green} textAnchor="middle">
        ヤニブ成功者が ＋{total} 総取り
      </text>
    </Figure>
  );
}

// ============ 部品 ============
function Section({ title, defaultOpen, children, accent }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div style={{ background: "#fff", borderRadius: 10, border: `1px solid ${C.line}`, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "16px 18px",
          background: "none",
          border: "none",
          textAlign: "left",
          color: C.ink,
        }}
      >
        <span style={{ fontSize: 17, fontWeight: 800, display: "flex", alignItems: "center", gap: 8 }}>
          {accent && <span style={{ width: 4, height: 18, background: accent, borderRadius: 2 }} />}
          {title}
        </span>
        <span
          style={{
            fontSize: 14,
            color: C.faint,
            transform: open ? "rotate(90deg)" : "none",
            transition: "transform 0.15s",
          }}
        >
          ▶
        </span>
      </button>
      {open && <div style={{ padding: "0 18px 18px", fontSize: 15, lineHeight: 1.75 }}>{children}</div>}
    </div>
  );
}

function Bullets({ items }) {
  return (
    <ul style={{ margin: 0, paddingLeft: 18 }}>
      {items.map((t, i) => (
        <li key={i} style={{ marginBottom: 6 }}>
          {t}
        </li>
      ))}
    </ul>
  );
}

function Badge({ children, color = C.ink }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 12,
        fontWeight: 700,
        padding: "2px 8px",
        borderRadius: 10,
        background: color,
        color: "#fff",
        marginRight: 6,
        verticalAlign: "1px",
      }}
    >
      {children}
    </span>
  );
}

// ============ ルール解説 ============
function RulesPage({ settings }) {
  const s = settings;
  const line = s.declareLine ?? 5;
  const decks = s.deckCount || 1;
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 12, color: C.sub, padding: "0 4px" }}>
        今の設定：{decks}デッキ（{decks * 54}枚）・宣言ライン{line}点・流局ポット{s.potEnabled ? "オン" : "オフ"}
        {s.doublePeriod > 0 ? `・倍マッチ${s.doublePeriod}ラウンドごと` : "・倍マッチなし"}
      </div>

      <Section title="準備" defaultOpen accent={C.navy}>
        <Bullets
          items={[
            "ジョーカー2枚を含む54枚（6人以上はデッキ2つ・108枚）",
            `今回は${decks}デッキ（${decks * 54}枚）`,
            "各5枚配り、山札の一番上をめくって最初の捨札にする",
          ]}
        />
      </Section>

      <Section title="カードの点数" accent={C.navy}>
        <Bullets items={["A=1、2〜10=数字どおり、J=11、Q=12、K=13、ジョーカー=0"]} />
        <CardPointsFigure />
      </Section>

      <Section title="手番" accent={C.navy}>
        <Bullets items={["自分の番では「カードを出して1枚補充」か「ヤニブ宣言」のどちらかをする"]} />
        <div style={{ fontWeight: 800, marginTop: 12 }}>出せる組</div>
        <Bullets
          items={[
            "1枚／同じ数字2枚以上／同じマークの連番3枚以上",
            "ジョーカーはどちらにも使える",
            "KとAはつながらない",
          ]}
        />
        <SetsFigure />
        <div style={{ fontWeight: 800, marginTop: 14 }}>補充</div>
        <Bullets
          items={[
            "山札の一番上か、直前の人が出した捨札の端から1枚",
            "3枚以上出ていたら両端のどちらかだけ取れる",
          ]}
        />
        <DrawFigure />
      </Section>

      <Section title="ヤニブ宣言" accent={C.green}>
        <Bullets
          items={[
            `カードを出す前に手札合計が${line}点以下なら宣言できる`,
            "宣言したら全員が手札を公開",
            "宣言ラインは設定で変更できる（通常5点、5人のときは7点を推奨）",
          ]}
        />
      </Section>

      <Section title="得点" accent={C.red}>
        <div style={{ fontWeight: 800 }}>
          <Badge color={C.green}>成功</Badge>宣言者が最小（同点含む）
        </div>
        <Bullets
          items={[
            "最高点の人との差を宣言者がもらい、最高点の人が払う",
            "最高点が複数なら差を折半し、端数は宣言者が多くもらえるよう切り上げ",
          ]}
        />
        <FlowFigure
          players={[
            { name: "A", total: 3, role: "宣言" },
            { name: "B", total: 20, role: "最高" },
            { name: "C", total: 12 },
            { name: "D", total: 8 },
          ]}
          arrows={[{ from: 1, to: 0, label: "17点" }]}
          caption="差 20−3=17 を、最高点のBが宣言者のAに払う"
        />
        <div style={{ fontWeight: 800, marginTop: 16 }}>
          <Badge color={C.red}>ヤニブ返し</Badge>宣言者より低い人がいた
        </div>
        <Bullets
          items={["宣言者が「差×20点」を最低点の人に払う", "最低点が複数なら全員にそれぞれ払う"]}
        />
        <FlowFigure
          players={[
            { name: "A", total: 5, role: "宣言" },
            { name: "B", total: 3, role: "最低" },
            { name: "C", total: 12 },
            { name: "D", total: 9 },
          ]}
          arrows={[{ from: 0, to: 1, label: "40点" }]}
          caption="差 5−3=2 の20倍＝40点を、宣言者のAが最低点のBに払う"
        />
      </Section>

      {s.potEnabled ? (
        <Section title="流局ポット" accent={C.amber}>
          <Bullets
            items={[
              "山札が尽きたら再シャッフルせず流局。点数の移動はなし",
              `全員が「手札合計−宣言ライン（${line}点）」をポットに入れる。マイナスになる人は0点`,
              `例：手札12点の人は${potPay(12, line)}点、手札4点の人は${potPay(4, line)}点を入れる`,
              "ポットは次のラウンドに持ち越し",
              "次にヤニブが成功した人が総取り。ヤニブ返しなら返した人が総取り（並んだら山分け）",
            ]}
          />
          <PotFigure line={line} />
        </Section>
      ) : (
        <Section title="山札が尽きたら" accent={C.amber}>
          <Bullets items={["捨札をシャッフルして山札に戻す"]} />
        </Section>
      )}

      <Section title="倍マッチ" accent={C.red}>
        <Bullets
          items={[
            s.doublePeriod > 0
              ? `${s.doublePeriod}ラウンドごとに、そのラウンドの点数移動が2倍（3倍のときもある）`
              : "設定した周期ごとに、そのラウンドの点数移動が2倍（今は周期オフ）",
            "アナウンスを忘れたら次のラウンドにずらす",
            "ずらしても、次の倍マッチは本来の予定から数える",
          ]}
        />
      </Section>
    </div>
  );
}

// ============ 早見表 ============
const EXAMPLES = [
  { tag: "成功", color: C.green, cond: "宣言者3点、最高点20点", result: "宣言者 +17、最高点の人 −17" },
  {
    tag: "成功",
    color: C.green,
    cond: "宣言者3点、20点が2人",
    result: "差17を折半して各9点払う（宣言者は +18）",
  },
  { tag: "返し", color: C.red, cond: "宣言者5点、最低3点", result: "宣言者が 差2×20＝40点 を払う" },
  {
    tag: "返し",
    color: C.red,
    cond: "宣言者5点、3点が2人",
    result: "2人にそれぞれ40点、計80点 払う",
  },
  { tag: "倍マッチ", color: C.amber, cond: "上の全部", result: "点数移動がすべて2倍" },
];

const PLAYER_TABLE = [
  {
    range: [3, 4],
    label: "3〜4人",
    deck: "1つ",
    line: "5点",
    pot: "オン（ほぼ発動しない）",
    note: "山札が切れる前に決着。読み合い中心で落ち着いた展開",
  },
  {
    range: [5, 5],
    label: "5人",
    deck: "1つ",
    line: "7点",
    pot: "オン",
    note: "終盤のダラダラが消えて決着が早い。流局でポットが積もると一気に熱くなる",
  },
  {
    range: [6, 8],
    label: "6〜8人",
    deck: "2つ",
    line: "5点",
    pot: "オン（ほぼ発動しない）",
    note: "山札が切れない。待ち時間は長いが荒れやすい",
  },
];

function QuickPage({ playerCount, settings = {} }) {
  const line = settings.declareLine ?? 5;
  const pays = POT_EXAMPLE_HANDS.map((h) => potPay(h, line));
  const examples = [
    ...EXAMPLES,
    {
      tag: "流局",
      color: "#6b675c",
      cond: `宣言ライン${line}点、手札が ${POT_EXAMPLE_HANDS.join("・")}点`,
      result: `各自「手札−${line}」で ${pays.join("＋")}＝計${pays.reduce((a, b) => a + b, 0)}点 がポットへ`,
    },
  ];
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <Section title="点数計算の早見表" defaultOpen accent={C.red}>
        <div style={{ display: "grid", gap: 8 }}>
          {examples.map((e, i) => (
            <div key={i} style={{ background: C.paper, borderRadius: 8, padding: "10px 12px" }}>
              <div style={{ fontSize: 13, color: C.sub }}>
                <Badge color={e.color}>{e.tag}</Badge>
                {e.cond}
              </div>
              <div style={{ fontSize: 16, fontWeight: 800, marginTop: 4 }}>→ {e.result}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="人数別おすすめルール" defaultOpen accent={C.navy}>
        <div style={{ display: "grid", gap: 8 }}>
          {PLAYER_TABLE.map((r) => {
            const here = playerCount >= r.range[0] && playerCount <= r.range[1];
            return (
              <div
                key={r.label}
                style={{
                  borderRadius: 8,
                  padding: "12px 14px",
                  background: here ? "#fff8ec" : C.paper,
                  boxShadow: here ? `inset 0 0 0 2px ${C.amber}` : "none",
                }}
              >
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 18, fontWeight: 900 }}>{r.label}</span>
                  {here && <span style={{ fontSize: 11, fontWeight: 800, color: C.amber }}>今の人数</span>}
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "auto 1fr",
                    columnGap: 12,
                    rowGap: 2,
                    fontSize: 14,
                    marginTop: 6,
                  }}
                >
                  <span style={{ color: C.faint }}>デッキ</span>
                  <strong>{r.deck}</strong>
                  <span style={{ color: C.faint }}>宣言ライン</span>
                  <strong>{r.line}</strong>
                  <span style={{ color: C.faint }}>流局ポット</span>
                  <strong>{r.pot}</strong>
                </div>
                <div style={{ fontSize: 13, color: C.sub, marginTop: 6, lineHeight: 1.6 }}>{r.note}</div>
              </div>
            );
          })}
        </div>
        <div
          style={{
            marginTop: 12,
            padding: "12px 14px",
            borderRadius: 8,
            background: C.ink,
            color: "#fff",
            fontSize: 14,
            fontWeight: 700,
            lineHeight: 1.7,
          }}
        >
          迷ったら、5人以下は1デッキ、6人以上は2デッキ、流局ポットは常にオン、5人のときだけ宣言ラインを7点
        </div>
      </Section>
    </div>
  );
}

// ============ 全画面シート ============
export function RulesSheet({ tab, setTab, settings, playerCount, onClose }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.paper,
        zIndex: 55,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          padding: "calc(env(safe-area-inset-top, 0px) + 14px) 16px 10px",
          borderBottom: `1px solid ${C.line}`,
          background: C.paper,
        }}
      >
        <div style={{ maxWidth: 520, margin: "0 auto", display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ display: "flex", flex: 1, background: "#e9e5da", borderRadius: 22, padding: 3 }}>
            {[
              { key: "rules", label: "ルール解説" },
              { key: "quick", label: "早見表" },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  border: "none",
                  borderRadius: 20,
                  fontSize: 15,
                  fontWeight: 800,
                  background: tab === t.key ? "#fff" : "transparent",
                  color: tab === t.key ? C.ink : C.sub,
                  boxShadow: tab === t.key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: C.ink,
              color: "#fff",
              borderRadius: 22,
              padding: "10px 16px",
              fontSize: 15,
              fontWeight: 800,
            }}
          >
            閉じる
          </button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", WebkitOverflowScrolling: "touch" }}>
        <div
          style={{
            maxWidth: 520,
            margin: "0 auto",
            padding: "14px 16px calc(env(safe-area-inset-bottom, 0px) + 32px)",
          }}
        >
          {tab === "rules" ? <RulesPage settings={settings} /> : <QuickPage playerCount={playerCount} settings={settings} />}
        </div>
      </div>
    </div>
  );
}

// 画面右下のボタン（試合中でもすぐ開ける）
export function RulesFab({ onOpen }) {
  return (
    <button
      onClick={onOpen}
      style={{
        position: "fixed",
        right: 16,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
        zIndex: 40,
        border: "none",
        background: C.ink,
        color: "#fff",
        borderRadius: 26,
        padding: "12px 18px",
        fontSize: 15,
        fontWeight: 800,
        boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
        display: "flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          background: "#fff",
          color: C.ink,
          fontSize: 13,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ?
      </span>
      ルール
    </button>
  );
}
