// 只檢查、不花 AI：列出「角色工坊已發佈，但走路影格版本落後」的人物。沒有就印 []。
import { pending } from './walk-lib.mjs';
console.log(JSON.stringify(await pending()));
