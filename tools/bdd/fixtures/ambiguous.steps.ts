import { createBdd } from 'playwright-bdd';
const { Given }=createBdd();
// 只供負面生成檢查，正常設定不載入；兩個定義刻意歧義，不能執行。
Given('ambiguous fixture step',async()=>{throw Error('Negative generation fixture must never execute');});
Given('ambiguous fixture step',async()=>{throw Error('Negative generation fixture must never execute');});
