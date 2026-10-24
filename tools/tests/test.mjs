import * as L from "../../src/logic.js";
const ok = (c, m) => console.log((c ? "OK  " : "NG  ") + m);
const S = { potEnabled: true };
// A=0 B=1 C=2 D=3
let r = L.computeRound({type:"success",multiplier:1,declarer:0,declarerHand:3,targets:[1],targetHand:20},4,0,S);
ok(r.deltas.join()==="17,-17,0,0","成功 差17");
r = L.computeRound({type:"success",multiplier:1,declarer:0,declarerHand:3,targets:[1,2],targetHand:10},4,0,S);
ok(r.deltas.join()==="8,-4,-4,0","成功 差7を2人で折半→各4");
r = L.computeRound({type:"success",multiplier:2,declarer:0,declarerHand:3,targets:[1,2],targetHand:10},4,0,S);
ok(r.deltas.join()==="16,-8,-8,0","成功 ×2");
r = L.computeRound({type:"back",multiplier:1,declarer:0,declarerHand:5,targets:[1,2],targetHand:2},4,0,S);
ok(r.deltas.join()==="-120,60,60,0","返し 差3×20を2人にそれぞれ");
r = L.computeRound({type:"draw",multiplier:1,hands:[10,5,0,7]},4,0,S);
ok(r.deltas.join()==="-5,0,0,-2" && r.potAfter===7,"流局 手札−宣言ライン5：10→5, 5→0, 0→0, 7→2 で計7");
r = L.computeRound({type:"draw",multiplier:2,hands:[10,5,0,7]},4,22,{...S,potRate:2});
ok(r.potAfter===22+14,"流局 レート×2・倍マッチは掛けない");
r = L.computeRound({type:"draw",multiplier:2,hands:[10,5,0,7]},4,0,{...S,multiplyPotIn:true});
ok(r.potAfter===14,"流局 倍マッチ倍率を掛ける設定");
r = L.computeRound({type:"success",multiplier:1,declarer:3,declarerHand:2,targets:[0],targetHand:12},4,22,S);
ok(r.deltas.join()==="-10,0,0,32" && r.potAfter===0,"成功でポット総取り");
r = L.computeRound({type:"back",multiplier:1,declarer:3,declarerHand:4,targets:[0,1],targetHand:1},4,23,S);
ok(r.potOut.join()==="11,11,0,0" && r.potAfter===1,"返しで山分け 端数切り捨て→ポットに1残る");
r = L.computeRound({type:"back",multiplier:1,declarer:3,declarerHand:4,targets:[0,1],targetHand:1},4,23,{...S,splitRemainder:"distribute"});
ok(r.potOut.join()==="12,11,0,0" && r.potAfter===0,"返しで山分け 端数配布");
r = L.computeRound({type:"success",multiplier:1,declarer:3,declarerHand:2,targets:[0],targetHand:12},4,22,{potEnabled:false});
ok(r.potOut[3]===0,"ポットオフでは獲得しない");
r = L.computeRound({type:"back",multiplier:1,declarer:0,declarerHand:3,targets:[1],targetHand:3},4,0,S);
ok(!!r.error,"返しで同点はエラー");
// 倍マッチ
ok(L.activeDouble(10,10,{})?.scheduled===10,"R10で通知");
ok(L.activeDouble(11,10,{10:{targetRound:11,announced:false}})?.scheduled===10,"ずらしてR11で通知");
ok(L.activeDouble(10,10,{10:{targetRound:11,announced:false}})===null,"ずらした後R10では出ない");
ok(L.activeDouble(20,10,{10:{targetRound:11,announced:true}})?.scheduled===20,"次はR20");
ok(L.nextDoubleRound(12,10,{})===20,"次の倍マッチ表示");
// 旧データ移行
const old = [[{from:0,to:1,points:10}]];
const n = L.normalizeRounds(old,2);
ok(n[0].type==="manual" && n[0].deltas.join()==="-10,10","旧形式の移行");
console.log(L.buildCsv(["A","B","C","D"],[L.computeRound({type:"draw",multiplier:1,hands:[1,2,3,4]},4,0,S)].map(x=>({...x,type:"draw",multiplier:1,hands:[1,2,3,4],potBefore:0}))));
r = L.computeRound({type:"success",multiplier:2,declarer:3,declarerHand:2,targets:[0],targetHand:12},4,22,{...S,multiplyPotOut:true});
ok(r.potOut[3]===22 && r.deltas[3]===20+22,"倍マッチでもポット獲得は等倍（古い設定値も無視）");
// 途中参加
{
  const rs=[L.computeRound({type:"success",multiplier:1,declarer:0,declarerHand:1,targets:[1],targetHand:9},2,0,{}),
            L.computeRound({type:"success",multiplier:1,declarer:2,declarerHand:0,targets:[0],targetHand:10},3,0,{})];
  rs.forEach(r=>{r.type="success";r.multiplier=1;r.potBefore=0;});
  const c=L.computeCumulative(["A","B","C"],rs,[0,0,1]);
  ok(c.series[0].C===null && c.series[1].C===0 && c.series[2].C===10 && c.totals.join()==="-2,-8,10","途中参加：R1後に参加、R2で+10");
  const csv=L.buildCsv(["A","B","C"],rs,[0,0,1]).split("\n");
  ok(csv[1].endsWith("8,-8,,8,-8,") && csv[2].endsWith("-10,0,10,-2,-8,10"),"途中参加：CSVの列がずれない");
}

// 宣言ライン連動
{
  const r5=L.computeRound({type:"draw",multiplier:1,hands:[12,4,5,6]},4,0,{potEnabled:true,declareLine:5});
  ok(r5.potIn.join()==="7,0,0,1" && r5.potAfter===8,"宣言ライン5：12→7, 4→0, 5→0, 6→1");
  const r7=L.computeRound({type:"draw",multiplier:1,hands:[12,4,5,6]},4,0,{potEnabled:true,declareLine:7});
  ok(r7.potIn.join()==="5,0,0,0" && r7.potAfter===5,"宣言ライン7：12→5、他は0");
  const r0=L.computeRound({type:"draw",multiplier:1,hands:[12,8,20,5,15]},5,0,{potEnabled:true,declareLine:5});
  ok(r0.potAfter===35 && r0.deltas.join()==="-7,-3,-15,0,-10","早見表の例：12・8・20・5・15→計35");
  const rz=L.computeRound({type:"draw",multiplier:1,hands:[1,2,3]},3,10,{potEnabled:true,declareLine:5});
  ok(rz.potAfter===10 && rz.deltas.every(d=>d===0),"全員ライン以下なら誰も払わずポットは据え置き");
}
// 次に始める人
{
  const S={potEnabled:true,declareLine:5};
  const rs=L.computeRound({type:"success",multiplier:1,declarer:0,declarerHand:2,targets:[1],targetHand:19},4,0,S);
  ok(JSON.stringify(L.nextStarter(rs,4))===JSON.stringify({who:[1],amount:17,all:false}),"成功：払った最高点の人から");
  const r2=L.computeRound({type:"success",multiplier:1,declarer:0,declarerHand:3,targets:[1,2],targetHand:10},4,0,S);
  ok(JSON.stringify(L.nextStarter(r2,4).who)==="[1,2]","成功で最高点が並ぶ→2人でじゃんけん");
  const rb=L.computeRound({type:"back",multiplier:1,declarer:3,declarerHand:5,targets:[0,1],targetHand:2},4,0,S);
  ok(JSON.stringify(L.nextStarter(rb,4))===JSON.stringify({who:[3],amount:120,all:false}),"返し：宣言者（2人に計120）から");
  const rd=L.computeRound({type:"draw",multiplier:1,hands:[12,20,3,20]},4,0,S);
  ok(JSON.stringify(L.nextStarter(rd,4))===JSON.stringify({who:[1,3],amount:15,all:false}),"流局：ポットに一番入れた人（並べばじゃんけん）");
  const rz=L.computeRound({type:"draw",multiplier:1,hands:[1,2,3,4]},4,0,S);
  ok(L.nextStarter(rz,4).all===true && L.nextStarter(rz,4).who.length===4,"流局で誰も払わない→全員でじゃんけん");
  ok(L.nextStarter(null,4)===null,"1ラウンド目は表示なし");
  // ポット獲得点
  const rr=[{...rd,type:"draw",potBefore:0},{...L.computeRound({type:"success",multiplier:1,declarer:2,declarerHand:1,targets:[0],targetHand:9},4,rd.potAfter,S),type:"success",declarer:2,targets:[0],potBefore:rd.potAfter}];
  const st=L.computeStats(["A","B","C","D"],rr);
  ok(st.potGained.join()==="0,0,"+rd.potAfter+",0" && st.potWins[2]===1,"統計：ポット獲得点の合計");
}
