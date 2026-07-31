/** class 串接：丟掉 falsy，保留順序，供 primitives 內部與呼叫端 className 併用。 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
