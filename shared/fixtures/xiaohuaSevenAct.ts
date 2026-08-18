/**
 * Local 7-act 小華 ingest fixture for parse → scene → shot without live NIM.
 * Distinct from the 6-beat SHOTLIST lock-sheet fixture in tkuZenPromo.ts.
 * mockStoryExtract splits blank-line paragraphs into scenes (max 8).
 */

export const XIAOHUA_SEVEN_ACT_TITLE = "[LOCAL TEST] 小華七幕 overnight";
export const XIAOHUA_SEVEN_ACT_GROUP = "動畫組";

export const XIAOHUA_SEVEN_ACT_MARKERS = `角色：小華（大二化工、粉橘短鮑伯齊瀏海、棕色大眼）、禪定龜龜（禪學社吉祥物龜龜）
場景：宿舍（晚上）、克難坡（石階老樹）、禪學社教室（坐墊茶香）
造型：小華＝米白寬鬆V領針織外套、淺綠內搭、橘色百褶裙、駝色斜背包、白襪白球鞋`;

/** Seven spoken-act paragraphs. Blank lines = scene breaks for mockStoryExtract. */
export const XIAOHUA_SEVEN_ACTS = [
  "第一幕　宿舍夜。小華坐在床沿，筆記本攤開又合上，台燈把粉橘短髮照得很軟。她輕聲說：我是大二化工系的小華。回想起大一的時光，說真的，有好多的不習慣。窗外蟲鳴一下一下，她把斜背包收到椅背，還是靜不下來。杯子裡的水早涼了，她卻沒喝。這一夜她只想把心裡那句話說清楚，不要再假裝自己沒事。",
  "第二幕　窗邊。她走到窗邊看夜色，校園路燈遠遠成一排。她問：宇宙呀，我能怎麼做？怎麼才能真正認識自己呢？風從窗縫進來，米色針織外套輕輕晃，她把下巴擱在手臂上。遠處有人騎車經過，鈴響一下就沒了。小華把瀏海撥開，還是想不明白自己要去哪，只知道宿舍的牆此刻特別窄。",
  "第三幕　異響。門邊傳來窸窣聲，好像有誰從書包裡翻出來。小華轉頭，眼睛睜大：咦？你是誰？房間裡只剩台燈與她自己的呼吸。橘色百褶裙皺了一角，她忘了拉平。那聲音又響一次，比剛才更近，像有個很小的腳步停在她的書包旁邊。",
  "第四幕　龜龜登場。禪定龜龜從書包旁探出頭，殼上帶一點禪學社的圓標。牠慢慢說：小華，我聽到你的困擾了。我是禪學社的禪定龜龜，我來拯救你了！小華愣在原地，第一次覺得夜裡不那麼空。牠的聲音不急，像在教室裡帶坐。小華張了張嘴，沒把「怎麼可能」說出來，只是盯著那雙不慌的眼睛。",
  "第五幕　答應。小華眼睛亮起來，雙手握著裙襬。她說：真的嗎？帶我去！禪定龜龜點一點頭，朝門口的方向歪著殼。小華穿上白襪白球鞋，把米白外套扣好三顆棕色大扣。她還是有一點怕，可是比一個人問宇宙好，於是她把燈關掉跟上。",
  "第六幕　克難坡。兩人走在克難坡石階，老樹影子被路燈拉長。禪定龜龜說：真的真的！風從老樹間穿過，小華跟在後面，駝色斜背包一下一下拍著腰。石階有點潮，她放慢腳步。坡頂的方向有燈光，像有人在等，也像一條她沒走過的路忽然出現。",
  "第七幕　禪學社。教室門推開，茶香與坐墊，牆上有淡淡的社課字跡。小華跟著禪定龜龜坐下，第一次覺得心裡安靜下來。她把外套袖口拉好，不再去翻那本合上的筆記。窗外克難坡的樹影還在，可是她已經不必一個人問宇宙了。茶還熱著，她點了點頭。",
] as const;

export const XIAOHUA_SEVEN_ACT_SCRIPT = `${XIAOHUA_SEVEN_ACT_MARKERS}

${XIAOHUA_SEVEN_ACTS.join("\n\n")}`;

export function xiaohuaSevenActCharCount(): number {
  return XIAOHUA_SEVEN_ACT_SCRIPT.length;
}
