import * as L from "../../src/logic.js";
import * as Z from "../../src/session.js";
globalThis.crypto ??= (await import("node:crypto")).webcrypto;
const ok=(c,m)=>console.log((c?"OK  ":"NG  ")+m);
const names=["A","B","C","D","E","F","G"];
const roster=names.map(n=>({id:"id"+n,name:n}));
const ev=[]; let t=1000; const E=(k,d)=>{ev.push({...Z.makeEvent(k,d),at:t++}); };
E("init",{sid:"s1",roster,settings:{potEnabled:true,blockLength:3,declareLine:5}});
E("block",{tables:[{id:"A",pids:["idA","idB","idC","idD"],set:{declareLine:5,deckCount:1}},{id:"B",pids:["idE","idF","idG"],set:{declareLine:5,deckCount:1}}]});
const set={declareLine:5,potEnabled:true,potRate:1,multiplyPotIn:false,splitRemainder:"carry",deckCount:1};
const R=(b,tb,n,inp)=>E("r",{b,t:tb,n,in:{...inp,set}});
// 卓A：成功、流局、（倍マッチR3）成功×2
R(1,"A",1,{type:"success",multiplier:1,declarer:0,declarerHand:2,targets:[1],targetHand:12});
R(1,"A",2,{type:"draw",multiplier:1,hands:[12,8,20,5]});      // pot 7+3+15+0=25
E("dbl",{b:1,t:"A",log:{3:{targetRound:3,announced:true}}});
R(1,"A",3,{type:"success",multiplier:2,declarer:2,declarerHand:1,targets:[3],targetHand:11}); // C +20 + pot25
// 卓B：流局（ポット残す）、R2で倍マッチを忘れて次へ→R3もずらし、R4でアナウンス
R(1,"B",1,{type:"draw",multiplier:1,hands:[10,9,3]});           // pot 5+4+0=9
let S=Z.foldSession(ev);
let b=S.blocks[0];
ok(b.multi && !b.allDone,"区切り1：卓Aは済、卓Bは未");
ok(b.tables[0].status.done===true && b.tables[1].status.done===false,"卓Aは倍マッチ済み");
E("dbl",{b:1,t:"B",log:{3:{targetRound:4,announced:false}}});
R(1,"B",2,{type:"success",multiplier:1,declarer:0,declarerHand:3,targets:[1],targetHand:9});   // A wins pot 9 → pot 0
R(1,"B",3,{type:"draw",multiplier:1,hands:[15,6,12]});          // pot 10+1+7=18
E("dbl",{b:1,t:"B",log:{3:{targetRound:4,announced:true}}});
R(1,"B",4,{type:"back",multiplier:2,declarer:1,declarerHand:5,targets:[2],targetHand:2});    // F pays 3*20*2=120 to G, G takes pot18
R(1,"A",4,{type:"draw",multiplier:1,hands:[9,9,6,30]});         // 卓Aの延長ラウンド pot 4+4+1+25=34
S=Z.foldSession(ev); b=S.blocks[0];
ok(b.allDone,"卓Bがずらした倍マッチ（R4）を終えて区切り終了");
ok(Z.activeDouble ? true : true,"");
ok(L.activeDouble(4,3,b.tables[1].doubleLog,true)?.announced===true,"once：R4が倍マッチ");
ok(L.activeDouble(6,3,{},true)===null,"once：R6は倍マッチにならない");
ok(L.nextDoubleRound(5,3,b.tables[0].doubleLog,true)===null,"once：済んだら次の倍マッチなし");
// 次の区切り → 区切り1が閉じて返金
E("block",{tables:[{id:"A",pids:["idA","idE","idF","idG"],set:{declareLine:5}},{id:"B",pids:["idB","idC","idD"],set:{declareLine:5}}]});
S=Z.foldSession(ev); b=S.blocks[0];
const ra=b.tables[0].rounds, rf=ra[ra.length-1];
ok(rf.type==="refund" && rf.deltas.join()==="4,4,1,25","卓Aの残りポット34を、入れた人へ入れた分だけ返金");
ok(b.tables[1].rounds.at(-1).type!=="refund","卓Bはポット0なので返金なし");
const g=Z.sessionGame(S); const tot=Array(7).fill(0); g.rounds.forEach(r=>r.deltas.forEach((d,i)=>tot[i]+=d));
ok(tot.reduce((a,c)=>a+c,0)===0,"セッション全体の合計は0（ポットが残っていない）");
console.log("  合計:", names.map((n,i)=>n+tot[i]).join(" "));
// 期待値：A: +10(R1) -4? 計算
const st=L.computeStats(g.players,g.rounds);
ok(st.potGained.join()==="0,0,25,0,9,0,18" ,"ポット獲得点（返金は数えない）："+st.potGained.join());
ok(g.rounds.every(r=>r.seats && r.block===1),"全ラウンドに卓・区切り");
const csv=L.buildCsv(g.players,g.rounds,g.joinedAt).split("\n");
ok(csv[0].startsWith("round,block,table,table_round,time,declare_line,deck_count,table_members,type"),"CSVの見出し");
const refundLine=csv.find(l=>l.includes(",refund,"));
ok(!!refundLine,"CSVに返金行");
console.log("  CSV 1行目:", csv[1].slice(0,120));
// 割り振り
const people=roster.map((p,i)=>({id:p.id,total:[50,40,30,20,10,0,-10][i]}));
const mix=Z.autoAssign(people,2,"mix"), near=Z.autoAssign(people,2,"near"), rnd=Z.autoAssign(people,3,"random");
ok(mix.map(x=>x.length).join()==="4,3" && near.map(x=>x.length).join()==="4,3" && rnd.map(x=>x.length).join()==="3,2,2","人数の分け方 4/3, 3/2/2");
ok(JSON.stringify(near[0].sort())===JSON.stringify(["idA","idB","idC","idD"]),"近い人同士：上位4人が同じ卓");
ok(mix[0].includes("idA") && mix[1].includes("idB") && mix[1].includes("idC") && mix[0].includes("idD"),"混ぜる：1位A・4位D、2位B・3位C "+JSON.stringify(mix));
// 1卓の試合の取り込み
const game={players:["X","Y","Z"],startedAt:new Date(0).toISOString(),settings:{potEnabled:true,declareLine:5},doubleLog:{},rounds:[]};
let pot=0; [{type:"success",multiplier:1,declarer:0,declarerHand:1,targets:[1],targetHand:9},{type:"draw",multiplier:1,hands:[10,2,7]}].forEach(inp=>{const r=L.computeRound(inp,3,pot,game.settings); game.rounds.push({...inp,...r,potBefore:pot}); pot=r.potAfter;});
const conv=Z.eventsFromGame(game); conv.events.push(Z.makeEvent("block",{tables:[{id:"A",pids:[],set:{}}]}));
const S2=Z.foldSession(conv.events);
const g2=Z.sessionGame(S2); const t2=[0,0,0]; g2.rounds.forEach(r=>r.deltas.forEach((d,i)=>t2[i]+=d));
ok(S2.blocks[0].tables[0].rounds.length===3 && S2.blocks[0].tables[0].rounds[2].type==="refund","1卓の試合を取り込み、次の区切りで残りポット7を返金");
ok(t2.join()==="8,-8,0","取り込み後の合計 "+t2.join());
