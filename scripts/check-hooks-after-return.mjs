#!/usr/bin/env node
/**
 * 守門：元件不得在「早退（early return）之後」呼叫 hook。
 *
 * 為什麼要有這支：專案頁曾經每開必炸，錯誤是 React #310
 * (Rendered more hooks than during the previous render)。原因是 ProjectPage 在
 * `if (project.isLoading) return …` 之後還有一個 useEffect——「載入中」那次 render
 * 少跑一個 hook，資料回來後多跑一個，React 直接丟例外，整頁進 ErrorBoundary。
 *
 * 這類 bug 本來該由 eslint 的 react-hooks/rules-of-hooks 擋掉，但本專案沒有裝
 * ESLint，於是沒有任何一道防線。在補上完整 lint 之前，先用與
 * check-import-boundaries / check-ui-primitives 相同的形式擋住這一種致命寫法。
 *
 * 判定範圍刻意收窄，避免誤報：
 * - 只看「元件／自訂 hook」（名稱大寫開頭，或 use 開頭）
 * - 只看該函式**自己**的語句，遇到巢狀函式就不再往下（巢狀元件有自己的 hook 順序）
 * - 只在該函式出現過 return 之後，才把 hook 呼叫算成違規
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();
const SCAN_DIRS = ["client/src"];

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) { out.push(...sourceFiles(full)); continue; }
    if (!/\.tsx?$/.test(entry)) continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

const isHookName = (n) => /^use[A-Z]/.test(n);

/** `useX(...)` 或 `trpc.a.b.useX(...)`：取出 hook 名稱，不是 hook 就回 null */
function hookNameOf(node) {
  if (!ts.isCallExpression(node)) return null;
  const e = node.expression;
  if (ts.isIdentifier(e) && isHookName(e.text)) return e.text;
  if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) && isHookName(e.name.text)) return e.name.text;
  return null;
}

const isFunctionLike = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isMethodDeclaration(n);

/** 取得函式名（宣告式、或 `const Name = () => {}`） */
function nameOf(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

/** 只有元件（大寫開頭）與自訂 hook（use 開頭）受 hook 規則約束 */
const isComponentOrHook = (name) => !!name && (/^[A-Z]/.test(name) || isHookName(name));

const violations = [];

for (const dir of SCAN_DIRS) {
  for (const file of sourceFiles(join(ROOT, dir))) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

    const visitTop = (node) => {
      if (isFunctionLike(node) && isComponentOrHook(nameOf(node)) && node.body && ts.isBlock(node.body)) {
        check(node, nameOf(node));
      }
      ts.forEachChild(node, visitTop);
    };

    function check(fn, fnName) {
      let firstReturn = null;   // 該函式第一個 return 的位置
      const returnSpans = [];   // return 語句的範圍：`return useMemo(…)` 不是違規
      const hooks = [];         // 該函式自己的 hook 呼叫

      const walk = (node) => {
        // 巢狀函式有自己的 hook 順序，不算進來
        if (node !== fn && isFunctionLike(node)) return;
        if (ts.isReturnStatement(node)) {
          if (firstReturn === null) firstReturn = node.getStart(sf);
          returnSpans.push([node.getStart(sf), node.getEnd()]);
        }
        const hook = hookNameOf(node);
        if (hook) hooks.push({ pos: node.getStart(sf), name: hook });
        ts.forEachChild(node, walk);
      };
      ts.forEachChild(fn.body, walk);

      if (firstReturn === null) return;
      const insideAReturn = (pos) => returnSpans.some(([s, e]) => pos >= s && pos < e);
      for (const h of hooks) {
        if (h.pos <= firstReturn || insideAReturn(h.pos)) continue;
        const { line } = sf.getLineAndCharacterOfPosition(h.pos);
        const { line: rLine } = sf.getLineAndCharacterOfPosition(firstReturn);
        violations.push({
          file: relative(ROOT, file),
          line: line + 1,
          returnLine: rLine + 1,
          fn: fnName,
          hook: h.name,
        });
      }
    }

    visitTop(sf);
  }
}

if (violations.length > 0) {
  console.error("check-hooks-after-return: 發現早退之後才呼叫的 hook（會造成 React #310，整頁崩潰）\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.fn}() 在第 ${v.returnLine} 行 return 之後呼叫了 ${v.hook}()`);
  }
  console.error("\n修法：把 hook 移到所有 return 之前。若它依賴 return 之後才定義的東西，用 ref 轉接。");
  process.exit(1);
}

console.log("check-hooks-after-return: OK（沒有元件在早退之後呼叫 hook）");
