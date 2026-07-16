# UX 缺陷專項審查(10 維度,經影響/可重現性裁判確認)

> 確認 38 筆(高 7/中 22/低 9);另 2 筆經裁判否決剔除。


## 🔴 高嚴重度

### 分鏡格「生成這一格／生成配音」直接扣點，無點數、無確認——牴觸 HelpPage 明文承諾與主生成台的確認彈窗

- **位置**:`client/src/components/SceneList.tsx:334`|**維度**:認知負荷|**工作量**:M
- **受影響**:所有創作者（逐格生成／配音是 Help 定義的核心日常步驟）、尤其怕花錢的法師/志工/新人；手機桌機皆然
- **現況**:SceneRow 的「生成這一格／重生這一格」(line 330-347) 點下去直接 generate.mutate 送真實生成並扣點（後端 generateInto→submitGenerationCore→reserveQuota）；「生成配音／重生配音」(line 266-283) 同理走 TTS 扣點。按鈕與旁邊「模型：…（日常主力）」(line 365) 都沒顯示點數，也沒有主生成台那種「預估 X 點＋目前剩 N 點＋確認」彈窗；「重生這一格」更是一鍵可重複觸發、每按一次靜默扣一次。這與 HelpPage 白紙黑字「送出前會先跳確認框讓你看預估點數，點頭才真的扣」、主生成台的確認彈窗、AssetLibrary「AI 描述入知識庫」的 ConfirmButton（依模型扣點）三處既定模式都不一致。
- **修法**:比照主生成台或 AssetLibrary describeImage：生成/配音改套 ConfirmButton，訊息顯示預估點數（點數可由前端 getModel(DEFAULT_MODEL).points 取得，已在 @shared/models）與剩餘點數；至少在按鈕標「約 −X 點」。
- **裁判備註**:逐行驗證屬實：SceneList.tsx:334「生成這一格／重生這一格」與 :270「生成配音／重生配音」的 onClick 直接 mutate，後端 scenes.generateInto/generateVoiceover 均走 submitGenerationCore→reserveQuota(model.points) 真實扣共用群組點數；該檔 ConfirmButton 僅用於退回(:384)與刪格(:402)，生成路徑無任何確認、無點數預估、無剩餘額度顯示（:365 模型 hint 也不含點數）。這直接牴觸 HelpPage.tsx:103 的通則承諾「送出前會先跳確認框讓你看預估點數，點頭才真的扣」，也與主生成台 ProjectPage.tsx:645-693 的 confirm-panel（預估約 X 點＋剩餘額度＋再想想）不一致。唯一緩解是 isPending/isGe…

### 首頁與頂欄完全不顯示「待審／待核准」，組長漏審、組員的生成/送審可能無限期卡住

- **位置**:`client/src/pages/Launchpad.tsx:226`|**維度**:導覽動線|**工作量**:M
- **受影響**:組長(漏審) + 送審或被成本門檻攔下的組員(被卡)
- **現況**:組員單筆生成達門檻會被攔成「⏳ 已送組長核准」(ProjectPage.tsx:171)、分鏡送審變「待審」；但核准 UI 只存在於各專案內部(GenerationList.tsx:485、SceneList.tsx:377，且 approvals.listByProject 僅在該專案開著時每 10 秒輪詢)。Launchpad 專案卡(此行起)只顯示類型/格式/更新時間，頂欄也無任何紅點或待辦數。多專案的組長根本不會知道哪個案子有東西等他核准，於是組員的生成/送審會靜靜卡住，沒有任何人被通知。
- **修法**:後端補一個組內待辦彙總(各專案 pending 核准/待審計數)，在專案卡角落與頂欄顯示待辦數(如「待核 3」)，點擊直達該專案審核區；至少在頂欄放一顆有數字的鈴鐺。
- **裁判備註**:屬實且非誤讀：Launchpad.tsx:226-246 的專案卡只顯示類型/格式/更新時間，App.tsx 頂欄無任何待辦紅點；核准 UI 與待核系統訊息（generationCore.ts:194 寫入的 message）都只在該專案內部可見（GenerationList.tsx:485、SceneList.tsx:422 的 listByProject 輪詢、MessagePanel 只掛在 ProjectPage.tsx:781），也沒有 email/push 通道。唯一跨專案途徑是組彙總 AI（要主動問、每次扣 1 點），是拉式問答不是被動提示——不構成已處理機制。對多專案的非技術組長，組員的生成被 awaiting_approval 真實擋住且被告知「等組長核准」，組長卻無從得知，工作流會靜靜無限期卡住，組員最終會以為系統壞了。後端 teamAssistant.ts:99-10…

### 新手導覽卡以「整組沒專案」為門檻,被邀進活躍組的新人完全看不到任何引導

- **位置**:`client/src/pages/Launchpad.tsx:94`|**維度**:新人上手|**工作量**:M
- **受影響**:手機/桌機,被邀請加入既有活躍組的新人(法師/志工/組員)——最常見的新人路徑
- **現況**:showFirstRun = groupId && hasNoProjects && !firstRunDismissed。hasNoProjects 是「整個組」層級(projects.data.length===0),不是「這位使用者是不是新人」。被邀請者接受邀請後 navigate 到作業台,若該組已有別人建的專案(絕大多數情況),FirstRunGuide 直接不渲染。新人第一眼看到的是一堆陌生人專案卡 +「今天想創作什麼?」+ 建立列,完全沒有五階段說明、沒有「建範例看看」的安全沙盒、沒有導覽。對不熟點數/生成/審核的非技術者,這是典型的不知道下一步、不知所措時刻。
- **修法**:把導覽門檻從「組是否為空」改成「這位使用者是否為新手/在此組尚無自己的專案」;或對『尚無自屬專案』的使用者常駐一張可略過的輕量歡迎條,內含『建立範例看看』與『看怎麼用』。FirstRunGuide 與 createSample 邏輯已具備,只需改觸發條件與加一個 per-user 記號。
- **裁判備註**:已重讀 Launchpad.tsx:93-94、FirstRunGuide.tsx、AcceptInvitePage.tsx 驗證:showFirstRun 確以「整組零專案」為門檻,FirstRunGuide 全站僅此一處渲染、createSample 無其他入口;受邀新人接受邀請後 navigate("/") 直落作業台,若組內已有專案(受邀加入既有活躍組的常態)則完全看不到任何導覽與零點數範例沙盒,唯一補償只有藏在漢堡選單的「怎麼用」連結。FirstRunGuide 註解寫明設計意圖是給首次進入者看,實作門檻卻讓最常見的新人路徑落空——非刻意取捨而是實作缺陷。對不熟點數/生成/審核的非技術受邀者,這是評準明訂的「不知道下一步」高嚴重度情境,且最需要安全沙盒的人(進入有真實專案與點數的組)反而拿不到。修法明確:門檻改為 per-user(去掉 hasNoProjects,僅以 firs…

### 會議筆記長文編輯無草稿保存也無離開提醒，切組/返回/手機切換即靜默丟失

- **位置**:`client/src/pages/PlannerPage.tsx:363`|**維度**:表單輸入|**工作量**:M
- **受影響**:手機與桌機的組員/志工/組長——所有在筆記卡寫長筆記的人
- **現況**:NotesCard 的標題/內容是純 useState（不像同專案的 KnowledgeBase 已用 useLocalDraft 邊打邊存 localStorage）。內容 textarea 可打到 40,000 字（開會逐字紀錄）。此時只要：頂欄切換組別（第54行 key=`note-${groupId}` 會整卡重掛）、點『回作業台』或任一導覽離開、手機把 App 切到背景被系統回收、當機/重整——正在打的內容全部無聲消失，沒有 beforeunload 攔阻、沒有本地草稿。更糟的是卡片說明（第308行）寫『內容更新會自動保留版本快照，不怕改壞』，那只保護『已儲存』的版本，會讓使用者誤以為編輯中也安全而更放心地離開。KnowledgeRow 的編輯模式（KnowledgeBase.tsx:336）也有同一缺口。
- **修法**:比照 useLocalDraft：新增筆記的 title/content 用 useLocalDraft(`note-new-${groupId}`) 邊打邊存、儲存成功後 clearDraft；編輯模式以 `note-edit-${editingId}` 為 key（等 seededRef 完成再啟用寫入，避免覆蓋載入中的空值）。另在有未存變更時掛 beforeunload 提示，或在 closeForm/離開前用 ConfirmButton 問一句『尚未儲存，要離開嗎』。
- **裁判備註**:逐項核實屬實：NotesCard title/content 為純 useState（PlannerPage.tsx:237-238），textarea 上限 40,000 字（:367），key=`note-${groupId}`（:54）切組即整卡重掛清空，全 client/src 無 beforeunload，草稿也不存 localStorage——而同專案 KnowledgeBase.tsx:50-51 已有現成 useLocalDraft 模式，證明是保護遺漏而非刻意取捨。更嚴重的是 :308 與 :385 兩處文案「內容更新會自動保留版本快照，不怕改壞」只保護已儲存版本，會讓非技術使用者對編輯中內容產生錯誤安全感。對目標使用者（手機開會打長篇會議紀錄的法師/志工），手機切背景被回收、頂欄切組、誤點返回都是高頻操作，長文無聲丟失＋誤導文案＝工作成果毀滅且無法自救，屬 high。K…

### 工作台完全沒有「專案檢視者」概念：整頁寫入控制對 viewer 全亮，按了才吃後端 FORBIDDEN

- **位置**:`client/src/pages/ProjectPage.tsx:195`|**維度**:權限可見性|**工作量**:M
- **受影響**:被組長設為「檢視者(viewer)」的組員（手機/桌機皆同）
- **現況**:ProjectPage 只從『組角色』算 myRole/isLeader（`me.data.groups.find(...).role`），從不讀『本專案角色』。後端 projects.get（server/routers/projects.ts:262-267）只回原始 project 列，完全不含呼叫者的專案角色；唯一含此資訊的 projects.listMemberRoles 只餵給權限卡顯示、不做任何 gate。結果：後端已用 assertProjectEditable 全面把 viewer 擋在世界觀/知識庫/角色卡/場景卡/分鏡編輯/就地生成/助手動作/工作流/生成台/素材上傳之外，但前端所有對應按鈕與輸入框都照常可用，viewer 一律「按了才失敗」，且錯誤是後端原字串。非技術者根本不知道自己是唯讀，只覺得『系統一直壞、每個動作都紅字』。
- **修法**:讓前端拿得到呼叫者的專案角色：projects.get 增回 myProjectRole 欄位（或在 ProjectPage 讀 listMemberRoles 找自己那列的 projectRole）→ 算出 canEdit → 頁首放一條常駐提示『你在此專案是檢視者，只能瀏覽/留言/下載，需編輯請組長到專案權限卡調整』，並把下列各寫入控制在事前 disable。這是根因，修好它後面 4 條可一起收斂。
- **裁判備註**:現況描述經實碼驗證屬實：ProjectPage.tsx:195 只從組角色算 myRole/isLeader；projects.get（server/routers/projects.ts:264-269）不回呼叫者的專案角色；client 端唯一讀 projectRole 的是 ProjectMembersCard（純顯示，grep 全 client 無其他消費者、無任何 readOnly gate）；後端則在世界觀(projects.ts:463)、知識庫(knowledge.ts:204 等 8 處)、角色卡(characters.ts:47/83/107)、場景卡(scenePresets.ts:47/75/92)、分鏡(scenes.ts:18/83)、生成(generation.ts:94)、助手(assistant.ts:246)、工作流(workflows.ts:86)、上…

### 生成台：檢視者走完整段「看價再花錢」確認儀式後，才被擋下

- **位置**:`client/src/pages/ProjectPage.tsx:636`|**維度**:權限可見性|**工作量**:S
- **受影響**:專案檢視者（生成台是主工作台，衝擊最大）
- **現況**:生成鈕的 disableReason（line 251-257）只檢查模型/提示詞/來源，完全沒有角色判斷。viewer 填好提示詞後看到『生成（−N 點）』是亮的，點下去→跳出確認彈窗（即將生成・預估 N 點・本週/今日額度）→按『確認生成』→submit.error 顯示後端原字串『你在此專案是「檢視者」（唯讀）…』。整個花錢前的鄭重確認流程跑到最後一步才說不行，對不熟點數/生成的創作者極度誤導。
- **修法**:在 disableReason 最前面加一條角色判斷：viewer 時回『你是檢視者，不能在此專案生成，請組長調整權限』，讓生成鈕事前 disable 並把原因顯示在旁邊那句 hint。effort S。
- **裁判備註**:實碼驗證屬實且無誤讀：disableReason（ProjectPage.tsx:251-257）僅檢查模型/提示詞/來源，line 195 的 myRole 是組角色而非專案級 viewer/editor，整頁無任何專案級角色查詢或唯讀 gating；viewer 的生成鈕（636）恆亮、點擊開「即將生成・預估 N 點・額度」確認彈窗（645-696），按「確認生成」後才被後端 generation.ts:94 assertProjectEditable 以 FORBIDDEN 擋下，錯誤字串與 projectAcl.ts:36 逐字吻合。且比發現所述更糟：mutation 無 onError 收合彈窗（setConfirming(false) 僅在成功或「再想想」觸發），出錯後確認彈窗仍開著、錯誤顯示在下方，viewer 可反覆點「確認生成」重複失敗，正是「以為壞了」情境。頁面上唯一透…

### 世界觀「定盤星」：檢視者打的字看起來存了、其實被靜默丟棄

- **位置**:`client/src/pages/ProjectPage.tsx:419`|**維度**:權限可見性|**工作量**:S
- **受影響**:專案檢視者（新人特別容易踩，因為第一步就是設世界觀）
- **現況**:logline/message 是 uncontrolled `defaultValue`＋onBlur 送出（line 419-431），主軸/調性/風格 chips 是樂觀更新（onMutate 先寫本地快取）。viewer 打完一句故事失焦→updateWv 觸發後端 FORBIDDEN→onError 只 invalidate，但輸入框因是 defaultValue 仍留著剛打的字（看起來已存），下次伺服器同步才悄悄還原；chips 則先亮起再彈回。畫面只閃一條紅字『世界觀儲存失敗：你在此專案是「檢視者」…』。非技術者會以為定盤星設好了，實際整段設定遺失。
- **修法**:canEdit=false 時把 logline/message 兩個 input 與三組 chips 設 readOnly/disabled，卡片頂端加一句『檢視者唯讀，如需修改請洽組長』；至少別讓輸入框保留未存的值造成『以為存了』。effort S。
- **裁判備註**:逐點對碼屬實:ProjectPage.tsx:419-431 確為 uncontrolled defaultValue+onBlur mutate;updateWv onMutate 樂觀寫快取、onError 只 invalidate(119-126);後端 projectAcl.ts:34-37 對 viewer 擲 FORBIDDEN(訊息即「你在此專案是『檢視者』…」);全檔無任何 viewer 閘控(grep 無 projectRole/readOnly/canEdit)。實況甚至比描述更糟:uncontrolled input 打過字後 refetch 不會還原顯示值,打的字整個 session 都留在框裡「看起來已存」,直到重載才消失;錯誤訊息渲染在卡片最底(line 541,與 logline 之間隔三組 chips+details),560px 手機上失焦當下在畫面外且無…


## 🟡 中嚴重度

### 在專案頁切換頂欄組別後，畫面仍停在他組的專案，頂欄點數/情境與內容互相矛盾且無提示

- **位置**:`client/src/App.tsx:173`|**維度**:導覽動線|**工作量**:S
- **受影響**:多組成員(跨組的組長/志工)
- **現況**:組別 select 的 onChange 只 setActiveGroupId(此行)，不做任何導航；ProjectPage 只吃路由的 id、不接 activeGroupId，所以切組後你仍停在原本那個(屬於前一組的)專案上。此時 PointsBadge(App.tsx:185)已換成新組的剩餘點數、頂欄顯示新組名，但你正編輯的是舊組的專案——狀態與內容彼此矛盾，非技術者會以為切換壞了或看錯點數。
- **修法**:切組時若目前在 /p/:id 且該專案不屬於新組，導回作業台(navigate("/"))，或顯示一條「已切到 X 組；這個專案屬於 Y 組」提示，讓情境切換與內容一致。
- **裁判備註**:現況描述屬實：App.tsx:173 的 onChange 只 setActiveGroupId、不導航；/p/:id（App.tsx:242）只吃路由 id，ProjectPage 不接 activeGroupId，且整頁不顯示專案所屬組名，切組後畫面確實停留在他組專案，而 PointsBadge（App.tsx:185）已即時換成新組點數——頂欄組名/點數與正在編輯的內容互相矛盾且無任何提示。對加入多組的非技術使用者，這會造成「切換壞了」的誤判與點數歸屬混淆（頂欄顯示 B 組點數、實際生成扣 A 組）。不到 high 因為不擋任務：專案內的扣費確認彈窗用的是專案自己的 groupId（ProjectPage.tsx:109/159），實際扣費與額度顯示皆正確，僅頂欄層級誤導；修法小（切組時若在 /p/:id 導回作業台，或在專案頁標示所屬組別），維持 medium。

### 「怎麼用」只藏在右上角自己名字的下拉選單裡,困惑當下找不到說明

- **位置**:`client/src/App.tsx:114`|**維度**:新人上手|**工作量**:S
- **受影響**:手機/桌機,第一次使用、遇到不懂名詞(點數/世界觀/送審)想找說明的新人
- **現況**:/help 全站唯一入口是 UserMenu(點自己頭像/名字→展開選單→怎麼用)。頂欄、作業台、新手導覽卡、空狀態都沒有任何可見的『?/說明/怎麼用』。HelpPage 內容其實很完整白話(FAQ+名詞辭典),但非技術者困惑時不會想到要去點『自己的名字』找教學,等於這份好內容在最需要時幾乎不可發現。
- **修法**:在頂欄放一個常駐可見的『怎麼用/?』入口(或在 FirstRunGuide 與各空狀態補『看怎麼用』連結指向 /help),讓困惑當下一眼就能找到說明。
- **裁判備註**:屬實且值得修。全 codebase 中 /help 僅有 App.tsx:114（UserMenu 下拉）一個入口；頂欄無「?」圖示，FirstRunGuide 新手卡與各空狀態皆無連到說明頁的連結，HelpPage 卻是完整的白話 FAQ+名詞辭典。對非技術背景的弘法創作者，遇到「點數/世界觀/送審」不懂時的直覺是找「?」或「說明」字樣，不會想到點自己的名字；且點數徽章只靠 title tooltip（App.tsx:73/80），手機上完全無法觸發，說明的不可發現性在手機上更糟。維持 medium：不是硬擋任務（選單項目少、最終可能翻到，FirstRunGuide 也提供了初次方向感），但在最需要說明的困惑時刻幾乎找不到，是典型可發現性缺陷；修法為 S 級（頂欄加 HelpCircle 按鈕＋新手卡/空狀態補一條「看完整說明」連結）。

### 接受「團隊層級(未指定組)」邀請後,第一眼就撞上「還沒有組別」死路

- **位置**:`client/src/App.tsx:211`|**維度**:新人上手|**工作量**:S
- **受影響**:桌機/手機,被以團隊成員(無組)身分邀請的新人;團隊管理員角色更會看到與身分不符的指示
- **現況**:AcceptInvitePage 支援 groupName 為空的團隊層級邀請(顯示 TEAM_ROLE_LABEL)。使用者填名字+密碼、成功加入後 navigate('/'),但此時 me.groups.length===0,App 立刻顯示空狀態『還沒有組別——請聯絡你的組長或管理員把你加入組』。剛完成加入的第一個畫面就是冷冰冰的死路,毫無『你已成功加入 {teamName}』的肯定或可操作下一步。若被邀者其實是團隊管理員(adminTeamIds>0),訊息叫他『去聯絡管理員』更是自相矛盾——他本人就能去 /admin 建組。
- **修法**:『還沒有組別』頁先肯定加入成功(帶出 teamName),再依角色給對的下一步:一般成員給明確等待說明,團隊管理員直接給『前往團隊管理建立/加入組』的按鈕。
- **裁判備註**:現況描述屬實且經實碼驗證:AcceptInvitePage.tsx:98 確有 groupName 為空的團隊層級邀請;:21 成功後 navigate('/');App.tsx:211 的 gate(groups.length===0 && !isSuperAdmin)包住整個內層 Switch,新人第一眼即是「還沒有組別」空狀態,無任何「已成功加入 {teamName}」肯定。更嚴重的是團隊管理員案例比發現所述還糟:isAdmin(App.tsx:151 含 adminTeamIds)讓 UserMenu 顯示「團隊管理」入口(:119),但 /admin 路由(:221)也被 :211 的 gate 擋住——本人就能建組的管理員被 UI 鎖在門外,還被指示「去聯絡管理員」,是自相矛盾的功能性死路,不只是文案問題。對非技術使用者,「剛加入就撞死路+選單連結點了沒反應」符合「以為壞了/按…

### 文件素材「加入知識庫」按下後零回饋：選單即關、無進行中/成功/失敗提示，連 error 都沒接線

- **位置**:`client/src/components/AssetLibrary.tsx:448`|**維度**:操作回饋|**工作量**:S
- **受影響**:桌機/手機的一般組員（上傳開示稿/腳本 doc 想讓 AI 讀懂的人）
- **現況**:AssetLibrary.tsx:448 的 toKnowledge.mutate 點擊後同一行就 setMenuOpenId(null) 把選單關掉，disabled={toKnowledge.isPending} 因選單已消失而不可見；成功只 invalidate 知識庫（成品出現在另一張、可能收合或在很遠處的『專案知識庫』卡），素材卡上沒有任何『已加入✓』；而元件底部的錯誤區（:505–507）只接了 del/rename/describeImage，toKnowledge 失敗是 100% 靜默。相鄰的圖片版『AI 描述入知識庫』(describeImage) 卻同時有『AI 描述中…』轉圈、『已描述入知識庫』綠字、與錯誤顯示。使用者按了看不到任何反應，會以為壞掉而重按（造成知識庫重複條目）。
- **修法**:比照 describeImage：toKnowledge 進行中在該素材卡顯示『加入知識庫中…』、成功短暫顯示『已加入知識庫✓』（沿用 describedId 那套 2.5 秒回饋），並在底部補上 {toKnowledge.error && ...} 錯誤行。
- **裁判備註**:逐行驗證屬實：AssetLibrary.tsx:448 點擊即 mutate+關選單，:446 的 disabled 隨選單消失而不可見；:48 的 toKnowledge onSuccess 只 invalidate 知識庫清單，素材卡上無任何成功標記；:505–507 錯誤區只接 del/rename/describeImage，toKnowledge.error 全檔未渲染，且全站無 toast／全域 mutation 錯誤處理（realtime.tsx:199 只在成功時廣播 invalidate）。相鄰圖片版 describeImage 卻有進行中轉圈(:394)、綠字成功(:399)、錯誤顯示(:507)三態，證明這不是刻意取捨而是遺漏。對非技術志工：按下去畫面零反應、失敗 100% 靜默，會以為壞掉而重按。下修理由不成立為 high：此動作非核心生成路徑、不扣點、成功最終會在…

### AI 導演「給我 3 個分鏡 idea」與「拆成分鏡」真實模式各扣 1 點，卻無點數提示、無確認

- **位置**:`client/src/components/DirectorCard.tsx:11`|**維度**:認知負荷|**工作量**:S
- **受影響**:所有創作者，尤其怕花錢、不熟扣費的新人/志工
- **現況**:DirectorCard 的「給我 3 個分鏡 idea」(line 11) 與 ScriptSplitCard 的「拆成分鏡」(ScriptSplitCard.tsx:34) 在真實模式各扣 1 點（server/routers/director.ts DIRECTOR_COST_POINTS=1），但按鈕與說明文字完全沒提點數、也沒任何確認步驟，點下去就送 LLM 扣點。相對地同頁的 AI 專案助手明寫『每次提問約 1 點』、AssetLibrary『AI 描述入知識庫』有 ConfirmButton、主生成台有確認彈窗——本站的一致原則就是「確認/揭示才扣點」，這兩處是破口，等於『擅自扣點』。
- **修法**:兩顆按鈕旁加白話點數提示『每次約 1 點（假生成模式免費）』；理想上比照 describeImage 套 ConfirmButton。
- **裁判備註**:實讀碼證實：DirectorCard.tsx:11 與 ScriptSplitCard.tsx:34 直接 mutate，UI 全無點數揭示或確認；server/routers/director.ts:37,134,194 確認兩端點各 reserveQuota 扣 1 點，且扣的是 groupId 組共享配額。一致性破口也屬實——ProjectAssistant.tsx:29 明文「任何花點數的動作都用 ConfirmButton」、line 77 揭示「每次提問約 1 點」，line 119 經助手觸發同一拆分鏡動作還會彈「會呼叫 AI 導演拆分鏡並扣點」確認，直接按卡片按鈕卻無聲扣點；AssetLibrary 同類 AI 動作也有 ConfirmButton＋扣點揭示。對不熟扣費的志工/新人是「按了才發現扣點」且動用全組共享點數，非主觀喜好。DirectorCard 甚至未 inva…

### 篩選/搜尋生成時若請求失敗，畫面謊稱「沒有符合條件的生成紀錄」

- **位置**:`client/src/components/GenerationList.tsx:353`|**維度**:載入空錯狀態|**工作量**:S
- **受影響**:桌機/手機・所有創作者（尤其用篩選或搜尋找舊生成的人）
- **現況**:分頁查詢 listByProjectPaged 只處理 isLoading 與空結果，完全沒有 isError 分支。一旦請求失敗，pagedRows 變空、paged.isLoading 為 false，程式就落到 line 353 顯示「沒有符合條件的生成紀錄。」——把「伺服器錯了」偽裝成「查無資料」。非技術者會以為自己搜尋錯、或作品不見了，直接放棄，而不知道只要重試就好。
- **修法**:在 line 352–355 之間補 paged.isError 分支：顯示人話錯誤訊息＋「再試一次」按鈕（onClick 呼叫 paged.refetch()），比照同專案 ModelsPage/Launchpad 既有的錯誤＋重試樣式。
- **裁判備註**:現況描述屬實:GenerationList.tsx 的 listByProjectPaged useInfiniteQuery(line 101-120)全檔無任何 isError/error 分支,失敗時 data 為 undefined → pagedRows=[]、isLoading=false,精準落入 line 353 的「沒有符合條件的生成紀錄。」空狀態;line 269-275 的錯誤 UI 只涵蓋四個 mutation。也無外部補救:api.ts 無全域 error link,main.tsx 是全預設 QueryClient(無 QueryCache onError/throwOnError),ErrorBoundary 只接 render error。對目標使用者是真傷害:手機弱網下搜尋/篩選失敗會被偽裝成「查無資料」,非技術創作者會以為作品不見或自己搜錯而放棄;組長用…

### 生成紀錄按「載入更多」時，畫面上原有的 30 筆會先整批消失再重新出現

- **位置**:`client/src/components/GenerationList.tsx:123`|**維度**:載入空錯狀態|**工作量**:S
- **受影響**:桌機/手機・生成超過 30 筆的專案（重度使用者）
- **現況**:顯示來源是 rows = browsing ? pagedRows : list.data（line 123）。按「載入更多」會把 expanded 設 true 使 browsing 轉真、改讀 pagedRows；但 listByProjectPaged 的 useInfiniteQuery（line 101）沒有設 placeholderData，首次載入時 pagedRows 為空陣列，於是原本 30 筆瞬間全部消失、只剩一行「載入中…」，載完才又冒出來——像資料被弄丟了，正是要避免的載入跳版。
- **修法**:給 listByProjectPaged 的 useInfiniteQuery 加 placeholderData:(prev)=>prev（比照 ModelsPage 搜尋的寫法），或在來源切換的載入期間先沿用 list.data 當回退，避免整批清空。
- **裁判備註**:逐行驗證屬實且無既有緩解機制：GenerationList.tsx:540 的「載入更多」只 setExpanded(true)，browsing 轉真後 line 123 改讀 pagedRows，而 line 101 的 useInfiniteQuery（enabled: browsing）無 placeholderData/initialData，全 codebase 亦無 setInfiniteData 預填——首次 fetch 期間 pagedRows 為空，原 30 筆整批卸載、只剩 line 352 一行「載入中…」。且比發現所述更糟：server/routers/generation.ts:157 分頁尺寸同為 30、排序相同，第一次點擊只會重載同樣 30 筆，使用者要再按第二次才真的看到第 31 筆以後；列表塌縮成一行還會造成底部按鈕位置的捲動跳位。對非技術、手機慢網路的…

### 生成完成／失敗狀態不會被報讀器宣告：狀態 pill 無 aria-live

- **位置**:`client/src/components/GenerationList.tsx:461`|**維度**:無障礙|**工作量**:S
- **受影響**:報讀器使用者（等待 AI 生成結果的創作者）
- **現況**:每列狀態顯示在 line 461 的 <span className="pill">（生成中…→完成 ✓／失敗（已退點）／待組長核准…），輪詢刷新時文字靜默替換，沒有任何 aria-live/role=status 宣告狀態轉變。唯一的完成提示是桌面通知（notifyDesktop），需另外授權且離頁才觸發；留在頁面上的報讀器使用者送出生成後，無從得知何時完成或失敗、是否已退點，只能反覆手動重讀列表。
- **修法**:為狀態轉變加一個視覺隱藏的 aria-live="polite" 區，在偵測到某筆由 queued/running 轉 done/failed 時（已有 prevStatusRef 的邊緣偵測邏輯，line 143-177）寫入「〈提示詞前 20 字〉已完成／失敗，已退 N 點」；或至少給狀態 pill 容器 role="status"。
- **裁判備註**:屬實。GenerationList.tsx:461 的狀態 pill 是純 <span>,無 aria-live/role="status";輪詢(8s/45s)靜默替換文字,報讀器不會宣告「生成中→完成/失敗(已退點)」。完成邊緣偵測(line 143-177)僅發 notifyDesktop(需授權、iOS Safari 等行動瀏覽器無 Notification API 直接不可用)與 document.hidden 時的標題徽章(報讀器不宣告),頁內無任何 live region;連 line 458 的失敗錯誤 div 也缺 role="alert"(對照 SceneList.tsx:310/452 有加)。全站其他處大量使用 role="status"/"alert"(App.tsx:62、ProjectPage.tsx:697、AdminPage 等),唯獨核心生成迴圈漏掉,是…

### 專案知識庫：檢視者可貼整篇逐字稿/批次匯入 30 檔，最後一鍵才 FORBIDDEN

- **位置**:`client/src/components/KnowledgeBase.tsx:252`|**維度**:權限可見性|**工作量**:S
- **受影響**:專案檢視者
- **現況**:『加入素材知識』鈕(line 252)、新增表單『加入知識庫』(line 190-196)、批次匯入 txt/md 與『選資料夾匯入』(line 204-225) 對 viewer 全部可用且無角色判斷。viewer 可以把一整篇師父開示逐字稿貼進去（還有 localStorage 草稿保存），或一次選 30 個檔跑完進度條，按下加入→後端 knowledge.add 回 FORBIDDEN。大量打字/選檔全部白費，且批次匯入可能逐檔失敗洗一排紅字。
- **修法**:canEdit=false 時隱藏/停用『加入素材知識』與批次匯入區塊（保留列表、編輯、刪除鈕也一併停用，因後端同樣擋 update/remove），改顯示一句『檢視者可閱讀知識庫，新增/修改請洽組長』。effort S。
- **裁判備註**:屬實且值得修，維持 medium。已重讀 client/src/components/KnowledgeBase.tsx 全檔驗證：元件只收 projectId（line 46），ProjectPage.tsx:547 無條件渲染；「加入素材知識」鈕（252-254）、加入表單與「加入知識庫」（190-196）、批次匯入 input 與「選資料夾匯入」（204-223）、甚至列內「編輯／刪除」（376-386）全無角色判斷——grep 全 client 確認沒有任何元件以專案 viewer 角色閘控寫入 UI。後端 knowledge.add 確在 server/routers/knowledge.ts:204 經 assertProjectEditable 對 viewer 丟 FORBIDDEN（viewer 是正式功能，需求 2.3）。批次流程（99-126）逐檔 catch 後繼續…

### 40,000 字上限的長文欄位不顯示剩餘字數，且截斷/報錯行為兩處不一致

- **位置**:`client/src/components/KnowledgeBase.tsx:181`|**維度**:表單輸入|**工作量**:S
- **受影響**:手機與桌機貼長逐字稿的組員（知識庫、筆記）
- **現況**:後端 knowledge.add 與 notes 都硬限 40,000 字（server/routers/knowledge.ts:196、notes.ts:96）。但兩個主要貼文欄位都沒有『已 N / 40,000 字』計數：知識庫手動內容 textarea（第181-187行）完全沒有 maxLength，使用者可把一篇長開示全文貼進去、耐心等一下按『加入知識庫』，才在第199行看到『內容過長（上限 40000 字）』，接著得自己盲抓要刪多少字（沒有計數可參考）；而筆記內容 textarea（PlannerPage.tsx:363）反而有 maxLength=40000，貼超長稿時被無聲截掉尾段、既無計數也無提示，使用者根本不知道後面不見了。同一個上限，一邊送出才報錯、一邊靜默吃字，體驗不一致。
- **修法**:兩處都加即時字數/剩餘顯示（如 `{content.length.toLocaleString()} / 40,000 字`，逼近上限轉警示色）；知識庫手動內容給 maxLength 或送出前的友善預檢，避免『貼完才被擋』；筆記端在接近/觸及上限時給一句提示，別無聲截斷。
- **裁判備註**:已重讀驗證:KnowledgeBase.tsx:181-187 的 textarea 確無 maxLength、無字數計數,錯誤僅在送出後由第199行顯示後端訊息(knowledge.ts:196 MAX_CONTENT=40000);PlannerPage.tsx:367 的筆記 textarea 確有 maxLength=40000 且無計數,超長貼上被瀏覽器靜默截尾、無任何提示。兩項現況描述皆屬實,無已處理機制被漏看。對目標使用者是真傷:元件 placeholder 明示「把開示逐字稿貼進來」,長開示逼近4萬字是設計上的主要情境,非邊角案例;筆記端無聲資料遺失對非技術者尤其誤導(以為存了全文),且同一上限兩處行為相反,無法建立一致心智模型。不擋任務(可分段貼、知識庫報錯有寫上限),故非 high;但超越打磨層級,medium 成立。修法為兩處加計數並統一超限行為,S 天級。

### AI 專案助手回覆對報讀器完全靜音：對話串無 role="log"/aria-live

- **位置**:`client/src/components/ProjectAssistant.tsx:81`|**維度**:無障礙|**工作量**:S
- **受影響**:報讀器使用者（含視障法師／志工）在專案頁使用 AI 助手
- **現況**:對話串容器（line 81 的 scrollRef div）沒有 role="log" 或 aria-live；line 155「助手思考中…」與非同步 push 進 turns 的 AI 回覆都不在活躍區。使用者按「問」後 input 立刻清空、畫面靜默更新，報讀器不會朗讀任何內容，很可能誤判「沒反應／壞了」，必須自己盲目 Tab/方向鍵在頁面裡摸索才找得到答案。同 codebase 的 MessagePanel（role="log"）與 ProjectPage 送審提示（role="status"）都已正確處理，唯獨這支頭牌助手漏掉。
- **修法**:對話串容器加 role="log" aria-live="polite" aria-relevant="additions"（新回覆自動朗讀），「助手思考中…」用 role="status" 包住，或另設一個視覺隱藏的 aria-live 區宣告「助手已回覆」。參照 MessagePanel 既有寫法即可。
- **裁判備註**:現況屬實:ProjectAssistant.tsx:81 的對話串容器無 role="log"/aria-live(連 tabIndex 都沒有),line 155「助手思考中…」是純 hint div,line 68 送出後 input 立即清空、AI 回覆非同步靜默 push——報讀器使用者按「問」後得到完全靜音,唯一變化(line 169 按鈕文字)非 live region 且焦點通常留在 input,無任何已處理機制。非主觀喜好:同 codebase MessagePanel.tsx:36(同構的可捲動訊息串)已做 tabIndex+role="log"+aria-label,ProjectPage.tsx:697 及多頁面用 role="status",此為專案自身無障礙標準的內部不一致,屬 WCAG 4.1.3 範疇。對視障法師/志工正是「以為壞了」的真傷體驗;但僅影響報讀器…

### 粗剪預覽全螢幕遮罩不可捲動又無觸控關閉退路,矮螢幕把關閉鈕擠出畫面等於卡死

- **位置**:`client/src/components/StoryboardPlayer.tsx:127`|**維度**:手機觸控|**工作量**:S
- **受影響**:手機使用者使用分鏡『粗剪預覽』,橫向/小手機/放大系統字級時最嚴重
- **現況**:overlay 是 position:fixed 的直向 flex、justify-content:center,但沒有 overflow:auto(127-138 行);中央畫面固定 min(58vh,620px),再加上進度條、字幕條、會換行成多列的五顆控制鈕與勾選列,矮螢幕(橫向或小手機)總高一旦超過視窗,內容被裁切且無法捲動(useFocusTrap 又鎖住背景捲動)。關閉方式只有 Esc(手機沒有此鍵,119 行)和控制列裡那顆會被擠掉的『關閉』鈕(338-341 行);點背景不會關(166 行 overlay 未接 onClick)。當關閉鈕落到畫面外,觸控使用者毫無退路,只能重新整理——對非技術者就像『卡死/壞掉』。
- **修法**:overlay 加 overflow-y:auto,讓內容超出時能捲到關閉鈕;中央畫面改用可壓縮高度(如搭配 flex-shrink 或 max-height)。同時補觸控退路:overlay onClick 判斷 e.target===e.currentTarget 即關閉(點背景關),或在遮罩右上角釘一顆常駐關閉鈕。
- **裁判備註**:逐行驗證屬實:overlay(127-138)為 fixed+flex+justify-content:center 且無 overflow,無 className 故無任何 CSS 可補救;中央畫面是固定 height:min(58vh,620px)(231 行)而非 max-height,加上表頭/進度條(~51px)、字幕條(46px+,配音詞多行會再長高)、會換行的五鈕控制列與勾選列、40px padding,橫向手機(~375px 視高)總高約 448px+ 必然溢出;且用 vh 非 svh/dvh,行動瀏覽器工具列吃掉視高後連小螢幕直向+放大字級也會溢出。justify-content:center 使裁切上下均分、無法捲動(useFocusTrap 於 interactions.tsx:28 另鎖 body 捲動),『關閉』鈕是控制列最後一個 flex item(338-34…

### 粗剪預覽的全域空白鍵攔截，讓「自動換鏡」核取方塊鍵盤按不動

- **位置**:`client/src/components/StoryboardPlayer.tsx:110`|**維度**:無障礙|**工作量**:S
- **受影響**:鍵盤使用者／報讀器使用者（尤其想開啟自動換鏡的減少動態偏好者）
- **現況**:line 108-125 在 window 掛 keydown，對 Space 一律 e.preventDefault()＋togglePlay。line 357 的「自動換鏡」核取方塊聚焦後按空白鍵時，該全域處理器先攔下並取消預設動作，結果是切換播放／暫停、而核取方塊不會被勾選/取消。純鍵盤使用者因此無法開關自動換鏡（減少動態者若想改成自動播放也卡住），且焦點在任何控制鈕上按空白都變成播放/暫停、而非啟動所在按鈕，行為違反預期。
- **修法**:全域 keydown 在 e.target 為表單控件（INPUT/BUTTON 等，或用 closest('input,button,[role]') 判斷）時略過、不 preventDefault；或把鍵盤監聽改掛在 stageRef 容器並排除互動元件。讓空白鍵在核取方塊上恢復原生切換。
- **裁判備註**:屬實且值得修。StoryboardPlayer.tsx:110-112 的 window keydown 對 Space 無條件 preventDefault()+togglePlay(),無任何 e.target 守衛;line 357 的「自動換鏡」原生 checkbox 靠 Space 啟動(keydown 被取消即失效)、Enter 不切換 checkbox,故純鍵盤使用者完全無法操作此開關——而這開關正是為減少動態偏好者(與鍵盤/報讀器族群高度重疊)設計的。interactions.tsx 的 useFocusTrap 只處理 Tab/Esc 且開啟時主動把焦點移入第一顆按鈕,鍵盤是此對話框的一等路徑,焦點在按鈕上按 Space 變播放/暫停亦違反預期。屬客觀 WCAG 2.1.1 缺陷,非主觀喜好。但主要族群(觸控/滑鼠)不受影響、核心播放任務鍵盤仍可用 Enter/方向鍵完成…

### 手機版章節導覽捲過即消失、跳階段又不寫入 URL——長頁面迷路，也無法分享「跳到第④階段」

- **位置**:`client/src/components/TocNav.tsx:64`|**維度**:導覽動線|**工作量**:M
- **受影響**:手機使用者 + 協作分享(組長對組員指路)
- **現況**:jump() 只用 scrollIntoView(此行起 64-70)，不寫任何 URL hash；手機版 .toc-rail 是 position:static(styles.css:379)，一旦捲進第②③階段，導覽列已在畫面外，沒有浮動/sticky 的快速跳轉，要換階段得先捲回最頂。又因跳轉不進 URL，組長無法把「看第④階段分鏡審核」用連結傳給組員，只能丟整個專案網址讓對方自己找。
- **修法**:手機版 TOC 改為可收合的 sticky 列或加浮動「跳章節」鈕；jump 時同步 history.replaceState 寫入 #stage-review 之類 hash，載入時讀 hash 自動捲到該階段，支援深連結與分享。
- **裁判備註**:兩項現況描述經實碼驗證均屬實，且無評審漏看的既有補救機制。(1) TocNav.tsx:64-70 的 jump() 只呼叫 scrollIntoView，不寫 URL hash；全 client 目錄 grep 不到任何 location.hash / useSearch / URLSearchParams 的深連結處理（ProjectPage.tsx、App.tsx 皆無），載入時也沒有讀 hash 捲動的機制——所以「組長無法傳『直達第④階段』的連結」成立，只能丟整個專案網址請對方自己捲。(2) styles.css:379 在 ≤820px 確為 .toc-rail { position: static }，且 jump() 第 69 行在手機點完自動收合（setOpen(false)）；ProjectPage（787 行、5 個 StageHead 區段）也沒有任何替代的 sti…

### 「點數與額度」卡在設定讀取失敗時永遠停在骨架，看起來像一直在載入

- **位置**:`client/src/pages/AdminPage.tsx:672`|**維度**:載入空錯狀態|**工作量**:S
- **受影響**:桌機/手機・團隊管理員與組長
- **現況**:line 672 用 settings.data ?（表單）:（三條灰色骨架）的三元式，缺少 settings.error 分支。quota.getSettings 一旦錯誤，settings.data 為 undefined，畫面就永遠卡在 else 的骨架上、且不顯示任何錯誤——管理員會以為還在載入而空等，其實請求已經失敗，沒有任何提示或重試出口。
- **修法**:把該三元改成 isLoading / error / data 三態：error 時顯示錯誤訊息＋重試鈕（settings.refetch()），只有真的 isLoading 才顯示骨架。
- **裁判備註**:屬實且值得修。AdminPage.tsx:561 的 getSettings 是裸 useQuery，line 672 三元式只有 data/骨架兩態，全檔無任何 settings.error 讀取；main.tsx QueryClient 為預設設定、ErrorBoundary 只接 render 例外，故 query 失敗後畫面永遠停在 line 693-697 的骨架，且該區塊 aria-label="設定載入中" 會持續誤導「還在載入」。同頁 line 619 已對 overview.error 顯示錯誤，證明此處是遺漏非取捨。對非技術管理員是「以為還在載入而空等、調額度任務卡死且無重試出口」的真實傷害。降為 high 不必：觸發需 overview 成功而 getSettings 失敗的局部失敗，且 React Query 預設重試與 refocus 重抓可自癒暫時性錯誤；降為 …

### 團隊管理頁在總覽讀取失敗時整頁只剩一行紅字，沒有標題也沒有重試

- **位置**:`client/src/pages/AdminPage.tsx:619`|**維度**:載入空錯狀態|**工作量**:S
- **受影響**:桌機/手機・團隊管理員與組長
- **現況**:line 619 `if (overview.error) return <p className="error">{overview.error.message}</p>;` 直接 return，讓整個管理頁（團隊/成員卡、邀請、額度、消耗監控、審計全部）被一行原始錯誤訊息取代，沒有頁標題、沒有『再試一次』；相較同專案 Launchpad 的清單錯誤有 refetch 鈕，這裡唯一恢復方式是重新整理瀏覽器。
- **修法**:保留頁標題與版面骨架，錯誤訊息旁加『再試一次』按鈕呼叫 overview.refetch()，與 Launchpad 的錯誤處理一致。
- **裁判備註**:屬實且值得修。AdminPage.tsx:619 確為 `if (overview.error) return <p className="error">{overview.error.message}</p>;`，錯誤時整個內容區（標題、團隊/成員卡、邀請、額度、消耗監控、審計）被一行原始 tRPC 錯誤訊息取代，無標題、無重試鈕；main.tsx 的 ErrorBoundary 只接 render throw、QueryClient 為預設值，該處無任何已處理機制。對照成立：Launchpad.tsx:208-213 已有「專案清單暫時載入不了——＋再試一次(refetch)」模式，連 App.tsx:223-225 的無權限分支都附「回作業台」連結，此處是同專案內的一致性缺口，非評審個人喜好。對非技術背景的團隊管理員/組長，原始（可能是英文的）錯誤訊息會被解讀為「系統壞了」，唯一可發…

### 資料下載區載入失敗時只有一行紅字、沒有重試按鈕，訊息還偏技術

- **位置**:`client/src/pages/DownloadsPage.tsx:56`|**維度**:載入空錯狀態|**工作量**:S
- **受影響**:手機/桌機・非技術背景使用者
- **現況**:清單用原生 fetch，失敗時 line 56 只渲染一行紅字 errMsg（內容可能是『HTTP 500』之類技術訊息），沒有任何『再試一次』按鈕；抓取只在元件掛載的 useEffect 跑一次，唯一的恢復方式是整頁重新整理瀏覽器——非技術者根本不會想到要這樣做，會以為這一頁壞了。
- **修法**:把 effect 內的抓取抽成可重呼叫的 load() 函式，errMsg 區塊旁加『再試一次』按鈕呼叫它；並把原始 HTTP 訊息包成人話（『清單暫時讀不到，請稍後再試』）。
- **裁判備註**:屬實且值得修。實讀 DownloadsPage.tsx 驗證:(1) 34-49 行確為原生 fetch 包在空依賴 useEffect,只在掛載跑一次,失敗後 data 停在 null、skeleton 消失,整頁只剩標題+56 行一行紅字(.error=13px 紅色小字,styles.css:226),無任何重試按鈕或 refetch 函式;此頁也是全站 tRPC/React Query 之外的孤例,沒有自動 retry/refetchOnWindowFocus。(2) 訊息偏技術屬實但例子略偏:伺服器 500 其實回友善中文「清單讀取失敗，請稍後再試」(server/index.ts:331),不過對手機 persona 最常見的網路閃斷會 throw TypeError: Failed to fetch——它是 Error 實例,43 行的友善中文 fallback 幾乎永不觸發…

### 按了「略過」導覽就永久消失,全站再也回不到「建立範例專案」這個安全沙盒

- **位置**:`client/src/pages/Launchpad.tsx:215`|**維度**:新人上手|**工作量**:S
- **受影響**:手機/桌機,反射性關掉東西的非技術新人
- **現況**:dismissFirstRun 寫入 localStorage(FIRST_RUN_KEY)後 showFirstRun 永遠為 false;createSample 在整個前端只被 FirstRunGuide 呼叫,而 FirstRunGuide 只在 showFirstRun 時渲染。因此一旦點『略過』(FirstRunGuide.tsx:84),就再也沒有任何 UI 能重看導覽或建立範例。取而代之的空狀態(此行:『還沒有專案 / 從上面開一個新專案』)也不含範例或說明連結——新人被迫直接開真專案,失去『不花點數、內容已填好』的唯一上手坡道,只差一次誤點。
- **修法**:空狀態常駐保留『建立範例專案看看』與『看怎麼用』連結(即使已略過);或在作業台/選單提供『重看新手導覽』。讓略過可逆、範例入口不會永久消失。
- **裁判備註**:程式碼逐點驗證屬實:dismissFirstRun 寫入 localStorage 後 showFirstRun 永久為 false 且無任何 UI 可重置(FIRST_RUN_KEY 只在 Launchpad.tsx 讀寫);createSample 全前端唯一呼叫點是 FirstRunGuide(只在 showFirstRun 時渲染);Launchpad.tsx:215 的空狀態與 HelpPage 皆無範例/導覽再入口;「略過」為單擊即生效、無確認無 undo。對不熟點數扣費與 AI 生成的非技術新人,一次誤點就永久失去唯一「不花點數、內容已填好」的安全上手沙盒,屬可回復性缺陷而非主觀喜好,修法為 S 級(空狀態補「建立範例專案」入口)。維持 medium 而非 high:不擋任務(仍可建真專案)、localStorage 每裝置獨立(誤點桌機不影響手機)、且導覽本只在組內零專案時…

### HelpTip 白話提示只靠 title/aria-label,觸控點「?」完全看不到說明

- **位置**:`client/src/pages/ProjectPage.tsx:43`|**維度**:手機觸控|**工作量**:S
- **受影響**:手機/平板觸控使用者,尤其非技術背景的法師/志工/組員
- **現況**:HelpTip 只渲染一個帶 title 與 aria-label、cursor:help 的 span,沒有任何 onClick/onFocus 顯示邏輯(43-59 行)。桌面靠滑鼠 hover 才會浮出 title 文字;觸控裝置沒有 hover,點「?」不會出現任何提示。而這些提示正是解釋「世界觀/調性(自動注入)/角色定裝卡/分鏡・交付/四步驟打勾」等關鍵概念的地方(339、403、461、490、552、763 行),是非技術者判斷『填這個要做什麼、會不會扣點、下一步是什麼』的主要輔助——在手機上等於整套白話說明全部消失,只剩看不懂的術語標題。
- **修法**:把 HelpTip 改成可點展開:加 useState,onClick/onFocus 就地彈出一個小 popover 或 inline 顯示 text(再點一次或點外面/Esc 收合),桌面 hover 行為保留。這樣觸控與鍵盤使用者都能看到白話提示,單一元件修一次全站受益。
- **裁判備註**:現況屬實:ProjectPage.tsx:43-59 的 HelpTip 只渲染帶 title/aria-label/tabIndex 的 span,無任何 onClick/onFocus 顯示邏輯(第 42 行註解宣稱「點擊顯示」但從未實作);全案無 tooltip 函式庫、styles.css 無 attr(title) 機制、無全域觸控處理。原生 title 在觸控裝置點擊不顯示、鍵盤 focus 也不顯示,aria-label 只服務讀屏——視覺型觸控使用者確實完全看不到六處提示(339/403/461/490/552/763 均確認),且「?」看起來可點但點了沒反應。對手機上的非技術法師/志工是真實傷害、非主觀喜好,修法也小(改成 state 切換的可見氣泡,S 級)。但 high 下修為 medium:原發現「整套白話說明全部消失、只剩看不懂的術語」誇大了影響面——6 處中 4…

### 約 787 行的專案頁沒有「回作業台」麵包屑，且頂欄非 sticky——手機上要回首頁得一路捲到最頂

- **位置**:`client/src/pages/ProjectPage.tsx:318`|**維度**:導覽動線|**工作量**:S
- **受影響**:手機使用者 + 新人
- **現況**:正常流程下回作業台的唯一入口是頂欄左上品牌 logo(App.tsx:164)，但 .topbar 沒有 position:sticky(styles.css:89)，在近 800 行的專案頁往下捲後整條頂欄消失；頁面本身(標題列 ProjectPage.tsx:275、此副標行)也沒有任何「← 回作業台」或麵包屑。手機使用者深入到第③④階段後想回列表，只能長距離往上捲，容易以為被困住。
- **修法**:頂欄加 position:sticky;top:0，或在專案頁標題上方放一條含組名/專案名的「← 回作業台」麵包屑，讓返回入口在長頁面全程可及。
- **裁判備註**:現況描述經逐項驗證屬實:styles.css:89 .topbar 無 sticky/fixed(全檔僅 .toc-rail 有 sticky);正常渲染下回作業台唯一入口是 App.tsx:164 的品牌 logo(ProjectPage.tsx:189 的「回作業台」連結只在錯誤分支出現);且手機 ≤820px 時 TocNav 也退為 position:static(styles.css:379),其項目僅五階段頁內錨點無回首頁——手機捲入約 787 行頁面深處後,回首頁、切組、點數、使用者選單全部不可及,無任何補救機制。對非技術手機使用者是明顯摩擦,非主觀喜好。未達 high 是因瀏覽器返回鍵仍可回作業台(未真正卡死),桌機另有 sticky 章節導覽減輕;維持 medium,修法為 topbar 加 sticky + 專案頁補「← 回作業台」麵包屑,S 級工作量。

### 範例專案的「從這裡開始」清單呈現不合邏輯的 ✓✗✓✗,像是壞了或自己跳步

- **位置**:`client/src/pages/ProjectPage.tsx:212`|**維度**:新人上手|**工作量**:S
- **受影響**:手機/桌機,被導覽引導去『建立範例專案看看』的新人(正是主要示範動線)
- **現況**:onboardSteps 完成判定:①設世界觀(logline 有值→範例已填→打勾)、②生成一鏡(需有 status='done' 的生成→範例沒有任何生成→未完成)、③加入分鏡(sceneCount>0→範例有4個 todo 分鏡→打勾)、④送審/打包(需有 approved 分鏡→範例沒有→未完成)。結果顯示為 ✓ ✗ ✓ ✗:第3步已打勾但第2步沒完成。對非技術者這是『我怎麼沒生成就完成了排分鏡?是不是壞了/我跳過了什麼』的困惑,而且就發生在被刻意引導進來的第一個示範裡,削弱『這是乾淨完整範例』的信任。
- **修法**:讓範例種一筆 status='done' 的示範生成(維持假生成/免費),使第2步也打勾;或把第3步完成條件改為需第2步先完成;或第2步在範例情境改用文案說明。
- **裁判備註**:逐項驗證屬實,無誤讀、無既有補救機制。(1) 完成判定確如所述:ProjectPage.tsx:212-218 四步分別以 logline/message 有值、有 status='done' 的生成、sceneCount>0、有 approved 分鏡判定,彼此獨立、無「前一步未完成則不打勾」的門檻。(2) 範例專案種子資料確會觸發 ✓✗✓✗:server/routers/projects.ts createSample 填了 logline+message(步1✓)、明確「絕不觸發任何 generation」(步2✗)、插入4筆 status='todo' 分鏡(步3✓)、無 approved(步4✗)。(3) 呈現加重矛盾:步驟列以編號圓圈+箭頭(1→2→3→4)渲染成明確的線性流程(ProjectPage.tsx:351-377),且 HelpTip(:339)寫「做到哪一步會自動…

### 五階段章節導覽在手機改成 static,捲下去就消失、無法在階段間跳轉

- **位置**:`client/src/styles.css:379`|**維度**:手機觸控|**工作量**:S
- **受影響**:手機使用者瀏覽 ProjectPage 五階段長工作台(約 787 行)
- **現況**:≤820px 時 .toc-rail 由桌面的 position:sticky 改成 position:static,TocNav 因此固定黏在頁面最上方(ProjectPage.tsx:385-386,五階段內容全排在它下面)。使用者一旦捲進第③素材整理/④分鏡審核/⑤交付,章節導覽早已捲出畫面外,想跳到別的階段只能一路手動捲回頁首再點。導覽偏偏在最需要它的情境(小螢幕+超長頁)失去作用,和桌面 sticky 的體驗落差很大。
- **修法**:手機版把收合後的『章節導覽』那條(.toc-toggle)改成 position:sticky; top:0(補上 z-index 與不透明底色),讓它一直釘在視窗頂端、隨時可展開跳轉;展開後點項目自動收起的既有邏輯(TocNav.tsx:69)不動。或改成右下角浮動按鈕開合清單。
- **裁判備註**:屬實且值得修。styles.css:377-380 確認 ≤820px 時 .toc-rail 由 sticky 改 static;ProjectPage.tsx:385-386 確認 TocNav 排在五階段內容之前的正常文流中,捲進 ③④⑤ 後即離開視窗。全站 grep 驗證無任何補償機制(無 back-to-top、無 fixed/sticky 浮動導覽、topbar 也非 sticky),手機上捲到頁面深處確實只能手動長捲回頂才能跳階段。TocNav.tsx:7 註解顯示 static 是刻意選擇(避免遮內容/水平捲動),但該顧慮可用「收合列 sticky + 展開清單改 overlay」同時滿足,並非不可兼得的取捨。對「手機+多人協作+非技術」的目標使用者,在最長的核心工作台頁(約787行渲染五階段大量卡片)喪失階段跳轉是明顯且反覆發生的摩擦,且與桌面體驗落差大。不到 high:…


## 🟢 低嚴重度

### 素材種類篩選宣告成 radiogroup 卻無方向鍵漫遊、且每顆都進 Tab 序，語意誤導報讀器

- **位置**:`client/src/components/AssetLibrary.tsx:217`|**維度**:無障礙|**工作量**:S
- **受影響**:報讀器使用者／鍵盤使用者（素材庫的種類篩選）
- **現況**:line 217 宣告 role="radiogroup"，line 224-236 每顆 role="radio" 都 tabIndex={0}、只綁 Enter/Space，沒有用專案既有的 useRovingRadio。ARIA 單選群組規範是 roving tabindex（只有選中項可 Tab、方向鍵在群組內移動）。此處報讀器會宣告「單選群組、用方向鍵選擇」，但方向鍵完全無作用；且 Tab 會逐顆停在全部（全部／圖片／影片／音訊…）而非一次跳過整組，與同 codebase 正確採 useRovingRadio 的回饋分類（FeedbackWidget/FeedbackPage）不一致，是被漏掉的一處。
- **修法**:改用既有的 useRovingRadio（values＝各 kind key、selected＝kindFilter、onSelect＝setKindFilter），把 groupProps 掛到 radiogroup、itemProps(i) 掛到各 radio，取代硬編的 tabIndex={0}；即恢復方向鍵漫遊與正確 Tab 行為。
- **裁判備註**:現況屬實且非主觀：AssetLibrary.tsx:217 確實宣告 role="radiogroup"，224-236 每顆 role="radio" 都 tabIndex={0} 且只綁 Enter/Space、無任何方向鍵處理，也未 import useRovingRadio；而 interactions.tsx:216 的 useRovingRadio 已實作完整 roving 模式（方向鍵/Home/End、僅選中項進 Tab 序），FeedbackWidget.tsx:207/325 與 FeedbackPage 均正確採用——這是客觀的 ARIA 模式違規＋同 codebase 不一致的漏網處，值得修。但嚴重度下修為 low：每顆 chip 都在 Tab 序且 Enter/Space 可操作，篩選功能對鍵盤與報讀器使用者完全可完成、無人被卡死；實際傷害是「宣告方向鍵可用但按了…

### 回收桶用單一全域 busy 鎖：還原/永久刪除任一項就停用整桶所有按鈕，且無逐項進度

- **位置**:`client/src/components/RecycleBin.tsx:90`|**維度**:操作回饋|**工作量**:S
- **受影響**:手機/桌機使用者，誤刪後想一次救回多個素材/分鏡/知識時
- **現況**:RecycleBin.tsx:90 的 busy 由六個 restore/purge mutation 的 isPending 聯集而成，:50 的『還原』與 :53 的『永久刪除』ConfirmButton 都 disabled={busy}。因此救回第一項時，整個回收桶所有還原/永久刪除鈕同時變灰，且沒有逐項『還原中…』，讀起來像整塊卡死；連續救回多項時每一項都要等一次往返、全桶反覆凍結。
- **修法**:改成逐列 pending：以正在處理的項目 id 記錄狀態，只 disable 該列並顯示『還原中…』，其餘列維持可操作（成功時項目消失＋回主庫已是足夠的成功回饋）。
- **裁判備註**:程式碼驗證屬實:RecycleBin.tsx:90-93 的 busy 為六個 mutation isPending 聯集,每列 DeletedRow(:141/:158/:176)都收同一個 busy,:50「還原」與 :53「永久刪除」皆 disabled={busy},且無逐項 pending 指示(無 spinner、無「還原中…」、無 optimistic update)。連續救回多項時整桶每次凍結一個往返、被點項目無進行中回饋,對非技術/手機使用者是真實但輕微的摩擦(可能誤以為沒按到)。緩解:凍結僅一次網路往返、成功後該列消失即為完成回饋、全域鎖也避免併發競態,不擋任務、不會卡死——維持 low(打磨級)。修法:以各 mutation 的 variables 比對 id 做逐列 pending 顯示,工作量 S。

### 分鏡格的行內編輯（配音詞/標題/秒數）失焦即存，但沒有『已儲存✓』確認

- **位置**:`client/src/components/SceneList.tsx:255`|**維度**:操作回饋|**工作量**:S
- **受影響**:手機/桌機一般組員，特別是編輯配音詞（唸稿）時
- **現況**:SceneList.tsx:255/230/241 的 InlineEdit 靠 onBlur 送出 update.mutate；成功時只是欄位重新啟用、值留著，沒有明確的儲存確認。全站已在世界觀卡（ProjectPage 的 logline）用『儲存中…／已儲存✓』訓練使用者期待這種回饋，這裡卻沒有——非技術者改完配音詞點別處後，不確定唸稿到底存了沒。（失敗時 rowError 會出現，故非全然靜默，但缺成功確認。）
- **修法**:在 InlineEdit 內加輕量 saved 狀態：commit 觸發 onCommit 後短暫顯示一個 ✓（或欄位旁『已儲存』2 秒淡出），沿用世界觀卡既有樣式，讓配音詞等重要內容有一致的存檔回饋。
- **裁判備註**:現況屬實：SceneList.tsx 的 InlineEdit（定義於 56-167 行，配音詞用於 255-262、標題 224、秒數 236）在 onBlur 觸發 commit → update.mutate，成功時唯一的視覺變化是 pending 期間欄位短暫 disabled（無文字、無 spinner、通常不到一秒），沒有任何「儲存中…／已儲存 ✓」回饋；失敗才有 rowError（310 行 role="alert"），所以「缺成功確認」的描述沒有誤讀、也沒有已存在但被忽略的機制。這不是純主觀喜好：全站已在 ProjectPage.tsx:405/414（世界觀 logline）、AdminPage.tsx:100/700、GroupOptionsEditor.tsx:59-61 用「儲存中…／已儲存 ✓」建立回饋慣例，唯獨分鏡格的行內編輯缺席，形成不一致；且「失焦即存」對非…

### 載入態不一致:主清單用骨架微光,多張小卡卻只給一行『載入中…』文字

- **位置**:`client/src/components/ScenePresetCards.tsx:40`|**維度**:一致性|**工作量**:S
- **受影響**:全部使用者(手機更明顯)
- **現況**:主要清單(GenerationList、SceneList、AssetLibrary、CharacterCards、ModelsPage、AdminPage 多卡)載入時用 .skeleton 微光佔位,版面高度穩定不跳。但一批卡片載入時只丟純文字『載入中…』:ScenePresetCards:40、RecycleBin:122、GroupOptionsEditor:41(門檻)、ApprovalThresholdCard、AdminPage GroupQuotaRow:82、VersionHistory:42。同一個工作台裡上下相鄰的卡,有的優雅微光、有的一行小灰字,且文字版佔位高度與載入後不同會造成內容跳動。對非技術者而言,一行『載入中…』也較容易被誤讀成『卡住了』。
- **修法**:把這些『載入中…』替換成與鄰近卡片同款的 .skeleton 佔位(沿用既有 gen-row/skeleton 高度),讓載入態全站一致、版面不跳。
- **裁判備註**:屬實且非誤讀:ScenePresetCards.tsx:39-40 確為純文字「載入中…」,無骨架;grep 證實 .skeleton 用於 GenerationList/SceneList/AssetLibrary/CharacterCards 等 14 檔,ScenePresetCards 不在其中——同一 ProjectPage 工作台內相鄰卡片載入表現不一致。文字佔位(約一行高)換成 220px 卡片網格會造成內容跳動,手機上會把下方「新增場景設定」按鈕推走,有誤點風險;這是可客觀衡量的版面位移(CLS),非純主觀喜好。但載入通常瞬間完成、「載入中…」對非技術者也可理解,不擋任務、不誤導決策,故維持 low(打磨級)。修法為套用既有 .skeleton pattern(同時可順修 RecycleBin、GroupOptionsEditor、VersionHistory 等同類處),…

### 圖示語彙不一致:狀態與「新增」到處混用彩色 emoji 與單色 Icon 元件

- **位置**:`client/src/pages/AdminPage.tsx:337`|**維度**:一致性|**工作量**:S
- **受影響**:全部使用者(管理員看審計/消耗卡,組員看生成狀態)
- **現況**:全站有一套刻意內嵌、單色 stroke 的 <Icon> 系統(Icon.tsx,為 CSP 專門內嵌 Lucide),但並行開發時有人直接打 emoji:審計卡 337 行成敗用 ✅/❌、消耗監控 398 行用 ⚠、GenerationList 60-61 行狀態標籤用 ⏳/⛔、ModelPicker 89 行用 ⚠︎;而同一個 Admin 側欄裡的系統自檢卡(262 行)成敗卻是用 <Icon name=CheckCircle2/XCircle> 配 token 顏色。自檢卡(單色)與正下方審計卡(彩色 emoji)並排,一眼就看得出不同源。emoji 是滿彩多色字符,直接違反設計語言「全站同時只允許一顆飽和赤陶發聲」,且在 Windows/Android/Mac 各自渲染成不同樣子。連「新增」鈕也分裂:CharacterCards 94 行、AdminPage 194/219 行用全形『＋』文字,而 KnowledgeBase 253 行、GroupOptionsEditor 338 行、PlannerPage 398 行用 <Icon name=Plus>,兩者粗細/基線對不齊。
- **修法**:把成敗/警告 emoji 一律換成既有 <Icon>(CheckCircle2/XCircle/TriangleAlert)並套 --success-ink/--danger-ink/--gold-ink;GenerationList 狀態標籤的 ⏳/⛔ 也改成圖示或純文字。所有「新增」鈕統一用 <Icon name=Plus>,移除全形『＋』文字。
- **裁判備註**:現況描述全部屬實(逐檔驗證:AdminPage 337 ✅/❌ vs 262 <Icon> 同側欄並排、398 ⚠、GenerationList 60-61 ⏳/⛔、ModelPicker 89 ⚠︎、＋文字 vs Icon Plus 分裂都存在),不是誤讀。但以「非技術弘法創作者」準繩衡量,這不擋任務、不誤導、不會讓人以為壞了——emoji ✅/❌/⏳ 對非技術者反而比單色 stroke 圖示更直覺,審計列還有 aria-label。真正的傷是設計語言一致性與跨平台渲染差異,屬設計師層級的打磨而非使用者可感知的摩擦,故從 medium 下修為 low;因是客觀存在的雙源不一致且修法便宜(S 級統一替換),仍值得列入打磨清單。

### 破壞性動作外觀不一致:移出組/重設密碼長得跟無害按鈕一樣,刪除色也漂移

- **位置**:`client/src/pages/AdminPage.tsx:143`|**維度**:一致性|**工作量**:S
- **受影響**:組長/團隊管理員(手機/桌機)
- **現況**:刪除/破壞性動作全站慣例是紅字(--danger-ink):KnowledgeBase:382、CharacterCards:62、GroupOptionsEditor:236、PlannerPage:210/340、ScenePresetCards:56 都是。但 AdminPage 成員列的『移出組』(143 行)與『重設密碼』(151 行)用 triggerStyle 只帶 padding/fontSize、完全沒有危險色,渲染成跟旁邊無害的『設為組長』一模一樣的中性按鈕。組長在成員列快速掃視時,無法用顏色分辨哪個是危險操作。另外 SceneList 刪除鈕(403 行)用的是原始飽和的 --danger(且是純 X 圖示、無文字),而其他刪除都用 AA 校過的 --danger-ink 文字『刪除』——同一個「刪除」語意出現三種呈現(中性/飽和 X/暗紅文字)。
- **修法**:把 AdminPage 的移出組/重設密碼 triggerStyle 補上 color:var(--danger-ink)(重設密碼可視為次危險,至少與移出組同級標示);SceneList 刪除鈕的顏色改為 --danger-ink 對齊全站,並補 aria/文字或沿用其他列的『刪除』字樣,讓破壞性動作的顏色與可辨識度一致。
- **裁判備註**:事實屬實:AdminPage.tsx:132 的 btn 樣式只有 padding/fontSize,143 行「移出組」與 151 行「重設密碼」的 ConfirmButton 無任何危險色,且 interactions.tsx 的 ConfirmButton 觸發鈕不帶預設樣式,渲染上確實與「設為組長」無法區分;全站 8 處破壞性 ConfirmButton 均用 --danger-ink 的慣例也查證為真,AdminPage 是離群者。但嚴重度下修為 low:兩個動作都有兩段式就地確認、文案明確交代後果(「之後隨時可以再邀請回來」「他會立刻被登出」),非技術使用者不會按了才發現後果,顏色缺失只影響掃視時的預先辨識而非造成實際損害;「移出組」本身可逆、受影響者僅限組長/管理員(系統中較熟練的角色)。屬視覺一致性打磨,值得順手修(S 級:兩處 triggerStyle 加 color,順…

### 排程『加入』鈕 disable 時不說明原因，非技術者不知卡在哪個欄位

- **位置**:`client/src/pages/PlannerPage.tsx:160`|**維度**:表單輸入|**工作量**:S
- **受影響**:手機與桌機的新人/組員（排程卡、筆記卡、知識庫新增皆同）
- **現況**:『加入』鈕 disabled={!canAdd}，而 canAdd 需要 title 且 startAt（第91行）。使用者若只填了標題、漏填那個較難操作的 datetime-local 開始時間，按鈕就一直灰著、點了也沒反應，旁邊完全沒有一句話說『還差開始時間』。唯一有訊息的是結束早於開始（第164行），但它用灰色 .hint（非 .error）且排在整列與按鈕之下，離『結束』欄位很遠，容易被當普通提示忽略。相對地，本專案別處都做對了：生成鈕有 disableReason 明說原因（ProjectPage.tsx:641）、回饋鈕有『至少評1題就能送出』（FeedbackPage.tsx:126）、加入邀請有『還差 N 個字』（AcceptInvitePage.tsx:106）。同樣的沉默 disable 也出現在筆記『儲存』（第387行）與知識庫『加入知識庫』（KnowledgeBase.tsx:192）。
- **修法**:沿用 ProjectPage 生成鈕的 disableReason 模式：在按鈕旁放一句動態說明（如『先填標題』『先選開始時間』），並把結束時間錯誤改為欄位旁的 .error 樣式即時顯示。同一模式套用到筆記儲存與知識庫加入。
- **裁判備註**:現況描述經逐行驗證屬實：PlannerPage.tsx:160 排程「加入」鈕 disabled={!canAdd}，canAdd（第91行）需 title+startAt，缺開始時間時按鈕沉默灰化、無任何動態訊息；筆記「儲存」（第387行，canSave 於第295行）與 KnowledgeBase.tsx:192「加入知識庫」同樣沉默 disable；唯一訊息是 endInvalid 的灰色 .hint（第164行）確實排在按鈕列之下。專案別處確有 disableReason 模式（ProjectPage.tsx:641），內部一致性論點成立，這是值得修的 S 級小修。但嚴重度應由 medium 下修為 low：發現漏引了一個關鍵既有機制——開始欄位的 label 明寫「開始（必填）」（第140行），使用者漏填時該必填欄位就在按鈕同一列（手機上直排更近），空著的必填欄位本身就是靜態說明…

### 假生成模式下生成台仍顯示「−X 點／預估約 X 點」卻不標「免費」，新手易誤以為沒生成或壞掉

- **位置**:`client/src/pages/ProjectPage.tsx:639`|**維度**:認知負荷|**工作量**:S
- **受影響**:首次測試者（未設 FAL_KEY 的假生成模式，即被引導的第一次體驗）
- **現況**:假生成模式生成不扣點（後端 billingBypassed），這也是新手熟悉操作的預設模式。但生成台按鈕仍寫『生成（−X 點）』(line 639)、確認彈窗寫『預估 約 X 點・目前剩 N 點』(line 655-660)，都沒標『假生成模式免費』。新手生成後看頂欄點數徽章沒減少，容易困惑『說要扣 X 點怎麼沒動？是不是沒成功？』。同專案的組彙總 AI 卡已正確標『（假生成模式免費）』，此處與 ProjectAssistant 未標，不一致。
- **修法**:info.mockMode（App 已在查）為真時，於生成台按鈕與確認彈窗附『假生成模式・本次免費』字樣，並同步補上 ProjectAssistant/DirectorCard。
- **裁判備註**:現況屬實:ProjectPage.tsx:639 按鈕寫「生成（−X 點）」、655-660 彈窗寫「預估約 X 點・目前剩 N 點」，且整個 ProjectPage 未引用 mockMode（grep 零命中），而後端 generationCore.ts:235 在假生成模式確實 billingBypassed 免扣點——「宣稱扣點、實際不扣」的落差存在，且與 Launchpad.tsx:294 已標「（假生成模式免費）」不一致。但嚴重度僅止於打磨:同畫面頂欄有金色「假生成模式」徽章（App.tsx:184）、HelpPage FAQ 明寫該模式「完全不花錢」；mock 生成會實際回傳測試素材出現在列表，使用者看得到成品，「以為沒生成/壞掉」不太會發生，困惑僅限「怎麼沒扣點」且屬暫時性試用階段。值得修（取用既有 info.mockMode 條件加註「假生成模式免費」，S 級），維持 lo…

### 工作台重複標題:同一段落連著出現兩次相同大標(角色定裝卡、分鏡・交付)

- **位置**:`client/src/pages/ProjectPage.tsx:762`|**維度**:一致性|**工作量**:S
- **受影響**:全部使用者(手機/桌機),尤其非技術新人
- **現況**:ProjectPage 為了給 TocNav 錨點,在元件外再包一個 <h2>。但這兩個元件本身已自帶標題:762 行外層 <h2>分鏡・交付</h2> 之後緊接的 SceneList(SceneList.tsx:447)又畫一個 <h2>分鏡・交付</h2>;551 行外層 <h2>角色定裝卡</h2> 之後 CharacterCards(CharacterCards.tsx:36)又畫 <h2>角色定裝卡(跨鏡一致)</h2>。畫面上就是同一個標題上下疊兩次(外層那個還帶 HelpTip)。而隔壁做法一致的 ScenePresetCards、AssetLibrary、KnowledgeBase 都是把錨點 id 掛在外層 <div>(如 #sec-scenes)、不加外層 h2,所以不會重複——同一頁兩種處理法並存,是並行開發沒對齊。非技術者看到標題重複會懷疑「是不是壞了/載重了」。
- **修法**:統一走 ScenePresetCards 的做法:把錨點 id(#sec-characters/#onboard-delivery)移到外層 <div> 上、刪掉 ProjectPage 那兩個外層 <h2>;若要保留 HelpTip,改成把提示併進元件自身標題(如 SceneList 的 h2 旁),整頁只留一個標題。
- **裁判備註**:現況屬實:ProjectPage.tsx:762 的外層 <h2>分鏡・交付</h2>(帶 HelpTip)之後,SceneList.tsx:447 又渲染一個同字樣 <h2>分鏡・交付</h2>;551 行外層 <h2>角色定裝卡</h2> 之後 CharacterCards.tsx:36 又渲染 <h2>角色定裝卡(跨鏡一致)</h2>。styles.css:114 對所有 h2 樣式相同,無任何機制隱藏或視覺區分外層標題,兩個大標同尺寸上下疊。同頁 KnowledgeBase(546)、ScenePresetCards(557)、RecycleBin(745)都用 <div id> 包裹、無外層 h2,證明這是兩種模式並存的未對齊,是缺陷非主觀喜好——所以 stands=true。但嚴重度下修為 low:重複標題不擋任何任務、不誤導下一步、不影響手機操作,TocNav 錨點仍正常(i…
