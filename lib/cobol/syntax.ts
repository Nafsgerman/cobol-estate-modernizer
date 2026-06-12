// lib/cobol/syntax.ts — pre-flight COBOL checks, ported from the advisor.
export type Severity = "error" | "warning";
export interface SyntaxIssue {
  severity: Severity;
  line: number | null;
  message: string;
  detail: string;
}

const DIV_SEC_RE =
  /^[ \t]*((IDENTIFICATION|ID)\s+DIVISION(\s+USING\s+\S+)?|(ENVIRONMENT|DATA|PROCEDURE)\s+DIVISION(\s+USING\s+\S+)?|(WORKING-STORAGE|FILE|LINKAGE|LOCAL-STORAGE|REPORT)\s+SECTION)[ \t]*$/i;

export function checkCobolSyntax(code: string): SyntaxIssue[] {
  const errors: SyntaxIssue[] = [];
  const upper = code.toUpperCase();
  const lines = code.split(/\r?\n/);

  lines.forEach((line, idx) => {
    const stripped = line.trim();
    const i = idx + 1;
    if (stripped.startsWith("*") || (line.length > 6 && line[6] === "*")) return;
    if (DIV_SEC_RE.test(line)) {
      errors.push({
        severity: "error",
        line: i,
        message: `Missing period after '${stripped}' on line ${i}`,
        detail: "Division and section headers must end with a period.",
      });
    }
  });

  const hasIdDiv = /\b(IDENTIFICATION|ID)\s+DIVISION\b/.test(upper);
  if (!hasIdDiv)
    errors.push({
      severity: "error",
      line: null,
      message: "Missing IDENTIFICATION DIVISION",
      detail: "Every COBOL program must begin with IDENTIFICATION DIVISION.",
    });
  if (hasIdDiv && !upper.includes("PROGRAM-ID"))
    errors.push({
      severity: "error",
      line: null,
      message: "Missing PROGRAM-ID",
      detail: "IDENTIFICATION DIVISION must include a PROGRAM-ID paragraph.",
    });
  if (!upper.includes("PROCEDURE DIVISION"))
    errors.push({
      severity: "error",
      line: null,
      message: "Missing PROCEDURE DIVISION",
      detail: "Every COBOL program must contain a PROCEDURE DIVISION.",
    });
  if (upper.includes("PROCEDURE DIVISION") && !upper.includes("STOP RUN"))
    errors.push({
      severity: "warning",
      line: null,
      message: "Missing STOP RUN",
      detail: "PROCEDURE DIVISION should terminate with STOP RUN.",
    });

  const order = [
    "IDENTIFICATION DIVISION",
    "ENVIRONMENT DIVISION",
    "DATA DIVISION",
    "PROCEDURE DIVISION",
  ];
  let prevPos = -1;
  let prevName: string | null = null;
  for (const div of order) {
    const pos = upper.indexOf(div);
    if (pos === -1) continue;
    if (pos < prevPos)
      errors.push({
        severity: "error",
        line: null,
        message: `Division order error: ${div} appears before ${prevName}`,
        detail:
          "Divisions must appear in order: IDENTIFICATION, ENVIRONMENT, DATA, PROCEDURE.",
      });
    prevPos = pos;
    prevName = div;
  }
  return errors;
}
