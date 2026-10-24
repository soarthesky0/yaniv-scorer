import * as Z from "../../src/session.js";
globalThis.crypto ??= (await import("node:crypto")).webcrypto;
const ok=(c,m)=>console.log((c?"OK  ":"NG  ")+m);
const roster=["A","B","C","D"].map(n=>({id:"i"+n,name:n}));
const set={declareLine:5,potEnabled:false};
const ev=[
 {id:"e1",at:1000,k:"init",sid:"s",roster,settings:{blockLength:3}},
 {id:"e2",at:2000,k:"block",no:1,tables:[{id:"A",pids:["iA","iB"],set:{}},{id:"B",pids:["iC","iD"],set:{}}]},
 // 卓Bの端末は時計が5秒遅れている（区切りより前の時刻で届く）
 {id:"e3",at:1500,k:"r",b:1,t:"B",n:1,in:{type:"success",multiplier:1,declarer:0,declarerHand:1,targets:[1],targetHand:9,set}},
 {id:"e4",at:2100,k:"r",b:1,t:"A",n:1,in:{type:"success",multiplier:1,declarer:1,declarerHand:1,targets:[0],targetHand:6,set}},
];
const shuffled=[ev[3],ev[2],ev[1],ev[0],ev[2]];   // 届く順がばらばら＋重複
const S1=Z.foldSession(ev), S2=Z.foldSession(shuffled);
const tot=S=>Z.sessionTotals(S).map(t=>t.total).join();
ok(tot(S1)==="-5,5,8,-8","時計がずれた卓の記録も取り込む："+tot(S1));
ok(tot(S1)===tot(S2),"届く順・重複に関係なく同じ結果");
// 同じ番号の区切りが2つ
const ev2=[...ev,{id:"x1",at:3000,k:"block",no:2,tables:[{id:"A",pids:["iA","iC"],set:{}}]},{id:"x2",at:3001,k:"block",no:2,tables:[{id:"A",pids:["iA","iB","iC","iD"],set:{}}]}];
const S3=Z.foldSession(ev2);
ok(S3.blocks.length===2 && S3.blocks[1].tables[0].pids.length===4,"同時に作られた区切り2はあとのほうを使う");
