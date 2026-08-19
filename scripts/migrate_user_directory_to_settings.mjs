import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyDatabaseForStorage } from '../backend/schema.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATABASE_PATH = path.join(ROOT, 'backend', 'data', 'db.json');

// 2026-08-08 自 Apps Script user_directory.gs 搬移；後續人員異動請直接編輯 JSON「設定」。
export const USER_DIRECTORY = [
  ['傅思凱','負責人','','eric.fu@emctaipei.com'],
  ['王穗紜','專案部','Joyce組','joyce.wang@emctaipei.com'],
  ['王藍庭','專案部','Celine組','celine.wang@emctaipei.com'],
  ['謝榕','專案部','Poppy組','poppy.hsieh@emctaipei.com'],
  ['郭佩盈','專案部','Cherry組','cherry.kuo@emctaipei.com'],
  ['陳柏政','設計部','平面','machi.chen@emctaipei.com'],
  ['林安芝','專案部','Ann組','ann.lin@emctaipei.com'],
  ['陳雅筠','專案部','Emily組','emily.chen@emctaipei.com'],
  ['許惠紋','專案部','Fiona組','fiona.hsu@emctaipei.com'],
  ['林書妤','專案部','Cherry組','wendy.lin@emctaipei.com'],
  ['鍾柏捷','專案部','Joyce組','bojie.zhong@emctaipei.com'],
  ['范若儀','專案部','Odin組','zoe.fan@emctaipei.com'],
  ['張鈞皓','專案部','Ann組','jerry.chang@emctaipei.com'],
  ['吳冠賢','企劃部','','saurman.wu@emctaipei.com'],
  ['許芷芸','設計部','平面','anna.hsu@emctaipei.com'],
  ['黎子瑄','專案部','Celine組','hsuan.li@emctaipei.com'],
  ['廖家緯','專案部','Odin組','odin.liao@emctaipei.com'],
  ['羅珮云','企劃部','','lorraine.luo@emctaipei.com'],
  ['周良峰','監測部','','benny.chou@emctaipei.com'],
  ['石昕宜','專案部','Odin組','cindy.shih@emctaipei.com'],
  ['李明庭','企劃部','','allen.li@emctaipei.com'],
  ['吳懷柔','專案部','Cherry組','orli.wu@emctaipei.com'],
  ['張亦忻','監測部','','mason.chang@emctaipei.com'],
  ['何韻雰','運釀企劃部','','yvette.ho@emctaipei.com'],
  ['鐘宏揚','設計部','影音','noise.zhong@emctaipei.com'],
  ['余采馨','專案部','Celine組','cindy.yu@emctaipei.com'],
  ['蔡宜君','管理部','人資行政組','lydia.tsai@emctaipei.com'],
  ['朱祖翎','企劃部','','livia.chu@emctaipei.com'],
  ['田倚菁','設計部','平面','amber.tian@emctaipei.com'],
  ['張心瑋','專案部','Helen組','helen.chang@emctaipei.com'],
  ['簡嘉頡','監測部','','hans.chien@emctaipei.com'],
  ['張晴','專案部','Emily組','deloise.chang@emctaipei.com'],
  ['劉伊庭','專案部','Joyce組','jennifer.liou@emctaipei.com'],
  ['周鈴真','專案部','Odin組','andrea.chou@emctaipei.com'],
  ['曾唯豪','監測部','','millicent.tseng@emctaipei.com'],
  ['莊亞馨','專案部','Joyce組','wendy.zhuang@emctaipei.com'],
  ['呂敏綺','專案部','Mickey組','mickey.lu@emctaipei.com'],
  ['鄭怡姍','專案部','Celine組','sammi.cheng@emctaipei.com'],
  ['陳家蓁','設計部','平面','leona.chen@emctaipei.com'],
  ['張書華','專案部','Poppy組','harper.chang@emctaipei.com'],
  ['潘柏翰','監測部','','sean.pan@emctaipei.com'],
  ['張凱銘','專案部','Mickey組','daniel.chang@emctaipei.com'],
  ['吳育儒','專案部','Celine組','lulu.wu@emctaipei.com'],
  ['鄭筱舢','專案部','Celine組','sasa.cheng@emctaipei.com'],
  ['孟承憲','專案部','Joyce組','hsien.meng@emctaipei.com'],
  ['曹又晨','專案部','Helen組','viola.tsao@emctaipei.com'],
  ['曾瀚萱','專案部','Joyce組','shelly.tseng@emctaipei.com'],
  ['廖秦葦','企劃部','','david.liao@emctaipei.com'],
  ['趙士閎','專案部','Joyce組','eddy.chao@emctaipei.com'],
  ['洪主恩','管理部','人資行政組','service@emctaipei.com'],
  ['張瑞敏','管理部','財務出納組','mavis.chang@emctaipei.com'],
  ['顏秀如','管理部','財務出納組','ruby.yen@emctaipei.com'],
  ['邱彣','專案部','Celine組','wayne.chiu@emctaipei.com'],
  ['廖翊宏','專案部','Celine組','ethan.liao@emctaipei.com'],
  ['曾鈺茜','專案部','Ann組','xixi.zeng@emctaipei.com'],
  ['古晟如','專案部','Mickey組','andrew.koo@emctaipei.com'],
  ['李法盛','專案部','Emily組','fallonlee25@gmail.com'],
  ['蔡啓泓','專案部','Poppy組','eric.tsai@emctaipei.com'],
  ['徐千涵','管理部','人資行政組','tina.hsu@emctaipei.com'],
  ['黃奕翔','專案部','Joyce組','ivan.huang@emctaipei.com'],
  ['洪嘉君','專案部','Mickey組','cc.hung@emctaipei.com'],
  ['潘炬晨','專案部','Celine組','riley.pan@emctaipei.com']
].map(([name, department, group, account]) => ({ name, department, group, account }));

const PRESERVED_ACCOUNT_NAMES = new Map([
  ['machi.chen@emctaipei.com', 'Machi'],
  ['anna.hsu@emctaipei.com', 'Anna'],
  ['noise.zhong@emctaipei.com', 'Noise'],
  ['amber.tian@emctaipei.com', 'Amber'],
  ['leona.chen@emctaipei.com', 'Leona']
]);

export function mergeUserDirectory(database) {
  const table = database?.tables?.['設定'];
  if (!table || !Array.isArray(table.rows)) throw new Error('db.json 缺少「設定」資料表');
  const headers = Array.isArray(table.headers) ? table.headers : [];
  const byAccount = new Map(table.rows.map(row => [String(row['帳號'] || '').trim().toLowerCase(), row]));
  const byName = new Map(table.rows.map(row => [String(row['名字'] || '').trim(), row]));
  let added = 0;
  let updated = 0;
  for (const person of USER_DIRECTORY) {
    const key = person.account.toLowerCase();
    let row = byAccount.get(key) || byName.get(person.name);
    const existed = Boolean(row);
    if (!row) {
      row = Object.fromEntries(headers.map(header => [header, '']));
      row['帳號'] = person.account;
      table.rows.push(row);
      byAccount.set(key, row);
      byName.set(person.name, row);
      added += 1;
    }
    const before = JSON.stringify(row);
    row['名字'] = PRESERVED_ACCOUNT_NAMES.get(key) || row['名字'] || person.name;
    row['顯示名'] ||= row['名字'];
    row['部門'] = person.department;
    row['組別'] = person.group;
    if (before !== JSON.stringify(row) && existed) updated += 1;
  }
  database.revision = (Number(database.revision) || 0) + 1;
  database.updatedAt = new Date().toISOString();
  return { added, updated, total: table.rows.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const database = JSON.parse(await readFile(DATABASE_PATH, 'utf8'));
  const summary = mergeUserDirectory(database);
  await writeFile(DATABASE_PATH, stringifyDatabaseForStorage(database), 'utf8');
  console.log(JSON.stringify(summary));
}
