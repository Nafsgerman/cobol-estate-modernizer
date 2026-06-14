import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SQL_PATH = resolve(process.cwd(), "lib/db/schema.sql");
const TS_PATH  = resolve(process.cwd(), "lib/db/schema.ts");

const sql = readFileSync(SQL_PATH, "utf8");
const ts  = readFileSync(TS_PATH,  "utf8");

function extractSqlEnum(name: string, src: string): string[] {
  const m = src.match(new RegExp(`CREATE TYPE ${name}\\s+AS ENUM\\s*\\(([^)]+)\\)`));
  if (!m) throw new Error(`Enum '${name}' not found in schema.sql`);
  return m[1].split(",").map((v) => v.trim().replace(/'/g, "").trim()).sort();
}

function extractTsEnum(varName: string, src: string): string[] {
  const m = src.match(new RegExp(`${varName}\\s*=\\s*pgEnum\\([^,]+,\\s*\\[([^\\]]+)\\]`));
  if (!m) throw new Error(`pgEnum '${varName}' not found in schema.ts`);
  return m[1].split(",").map((v) => v.trim().replace(/['"]/g, "").trim()).sort();
}

const PAIRS: Array<[string, string]> = [
  ["analysis_mode", "analysisMode"],
  ["run_status",    "runStatus"],
  ["node_type",     "nodeType"],
  ["dependency_type","dependencyType"],
  ["rule_category", "ruleCategory"],
  ["ticket_status", "ticketStatus"],
  ["ticket_priority","ticketPriority"],
  ["ticket_kind",   "ticketKind"],
];

let ok = true;
for (const [sqlName, tsName] of PAIRS) {
  const sqlVals = extractSqlEnum(sqlName, sql);
  const tsVals  = extractTsEnum(tsName,  ts);
  const missing  = sqlVals.filter((v) => !tsVals.includes(v));
  const extra    = tsVals.filter((v) => !sqlVals.includes(v));
  if (missing.length || extra.length) {
    console.error(`MISMATCH  ${sqlName}`);
    if (missing.length) console.error(`  in SQL not in TS: ${missing.join(", ")}`);
    if (extra.length)   console.error(`  in TS not in SQL: ${extra.join(", ")}`);
    ok = false;
  } else {
    console.log(`OK        ${sqlName}  [${sqlVals.join(", ")}]`);
  }
}
process.exit(ok ? 0 : 1);
