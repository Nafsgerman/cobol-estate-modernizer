// app/api/admin/backfill/route.ts
// TEMPORARY one-shot route: writes real COBOL source into each program row.
// Matches the seeded estate: BILMAIN → RECONA → (RECONB ↔ RECONA cycle),
// BILMAIN → RPTGEN → DBWRITE, RECONA → DBWRITE.
// Hit once, confirm the JSON shows updated:5, then DELETE this route.
import { db } from "@/lib/db";
import { program } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCES: Record<string, string> = {
  BILMAIN: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. BILMAIN.
      *> Billing cycle driver. Reads the billing master, reconciles each
      *> account via RECONA, then drives report generation via RPTGEN.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT BILL-FILE ASSIGN TO "BILLMAST"
               ORGANIZATION IS INDEXED
               ACCESS MODE IS SEQUENTIAL
               RECORD KEY IS BILL-ACCT
               FILE STATUS IS WS-FS.
       DATA DIVISION.
       FILE SECTION.
       FD  BILL-FILE.
       01  BILL-REC.
           05  BILL-ACCT      PIC X(10).
           05  BILL-AMOUNT    PIC 9(09)V99.
           05  BILL-STATUS    PIC X(01).
       WORKING-STORAGE SECTION.
       01  WS-FS              PIC X(02).
       01  WS-EOF             PIC X VALUE 'N'.
       01  WS-RECON-RESULT    PIC 9(09)V99.
       01  WS-ACCT-COUNT      PIC 9(06) VALUE 0.
       PROCEDURE DIVISION.
       MAIN-PARA.
           OPEN INPUT BILL-FILE
           PERFORM UNTIL WS-EOF = 'Y'
               READ BILL-FILE
                   AT END MOVE 'Y' TO WS-EOF
                   NOT AT END
                       ADD 1 TO WS-ACCT-COUNT
                       CALL 'RECONA' USING BILL-ACCT BILL-AMOUNT
                                           WS-RECON-RESULT
                       MOVE WS-RECON-RESULT TO BILL-AMOUNT
               END-READ
           END-PERFORM
           CLOSE BILL-FILE
           CALL 'RPTGEN' USING WS-ACCT-COUNT
           STOP RUN.`,

  RECONA: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. RECONA.
      *> Reconciliation pass A. Validates the account balance, persists an
      *> audit row via DBWRITE, and for disputed accounts hands off to
      *> RECONB — which calls back into RECONA, forming the A<->B cycle.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-VALIDATED       PIC 9(09)V99.
       01  WS-DISPUTE-FLAG    PIC X VALUE 'N'.
       01  WS-PASS-COUNT      PIC 9(03) VALUE 0.
       LINKAGE SECTION.
       01  LK-ACCT            PIC X(10).
       01  LK-AMOUNT          PIC 9(09)V99.
       01  LK-RESULT          PIC 9(09)V99.
       PROCEDURE DIVISION USING LK-ACCT LK-AMOUNT LK-RESULT.
       RECON-PARA.
           ADD 1 TO WS-PASS-COUNT
           COMPUTE WS-VALIDATED = LK-AMOUNT * 1.00
           CALL 'DBWRITE' USING LK-ACCT WS-VALIDATED
           IF LK-AMOUNT > 50000 AND WS-PASS-COUNT < 3
               MOVE 'Y' TO WS-DISPUTE-FLAG
               CALL 'RECONB' USING LK-ACCT LK-AMOUNT WS-VALIDATED
           END-IF
           MOVE WS-VALIDATED TO LK-RESULT
           GOBACK.`,

  RECONB: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. RECONB.
      *> Reconciliation pass B (dispute path). Re-runs reconciliation by
      *> calling RECONA a second time — this is the deliberate back-edge
      *> that closes the RECONA<->RECONB cycle.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-ADJUSTED        PIC 9(09)V99.
       01  WS-RECHECK         PIC 9(09)V99.
       LINKAGE SECTION.
       01  LK-ACCT            PIC X(10).
       01  LK-AMOUNT          PIC 9(09)V99.
       01  LK-RESULT          PIC 9(09)V99.
       PROCEDURE DIVISION USING LK-ACCT LK-AMOUNT LK-RESULT.
       RECHECK-PARA.
           COMPUTE WS-ADJUSTED = LK-AMOUNT * 0.95
           CALL 'RECONA' USING LK-ACCT WS-ADJUSTED WS-RECHECK
           MOVE WS-RECHECK TO LK-RESULT
           GOBACK.`,

  RPTGEN: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. RPTGEN.
      *> Billing report generator. Formats the run summary and writes each
      *> output line through DBWRITE for the reporting tables.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-LINE            PIC X(80).
       01  WS-IDX             PIC 9(06).
       01  WS-DUMMY-AMT       PIC 9(09)V99 VALUE 0.
       LINKAGE SECTION.
       01  LK-COUNT           PIC 9(06).
       PROCEDURE DIVISION USING LK-COUNT.
       REPORT-PARA.
           PERFORM VARYING WS-IDX FROM 1 BY 1
                   UNTIL WS-IDX > LK-COUNT
               STRING 'ACCOUNT LINE ' WS-IDX
                   DELIMITED BY SIZE INTO WS-LINE
               CALL 'DBWRITE' USING WS-LINE WS-DUMMY-AMT
           END-PERFORM
           GOBACK.`,

  DBWRITE: `       IDENTIFICATION DIVISION.
       PROGRAM-ID. DBWRITE.
      *> Persistence leaf. Writes a row to the DB2 billing audit table.
      *> Pure sink — calls nothing, so it terminates every chain.
       ENVIRONMENT DIVISION.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
           EXEC SQL INCLUDE SQLCA END-EXEC.
       01  WS-SQLCODE         PIC S9(09) COMP.
       LINKAGE SECTION.
       01  LK-KEY             PIC X(10).
       01  LK-VALUE           PIC 9(09)V99.
       PROCEDURE DIVISION USING LK-KEY LK-VALUE.
       WRITE-PARA.
           EXEC SQL
               INSERT INTO BILLING_AUDIT (ACCT_KEY, ACCT_VALUE)
               VALUES (:LK-KEY, :LK-VALUE)
           END-EXEC
           MOVE SQLCODE TO WS-SQLCODE
           IF WS-SQLCODE NOT = 0
               DISPLAY 'DBWRITE FAILED: ' WS-SQLCODE
           END-IF
           GOBACK.`,
};

export async function GET() {
  try {
    const results: { programId: string; updated: boolean; length: number }[] = [];
    for (const [pid, src] of Object.entries(SOURCES)) {
      const rows = await db
        .update(program)
        .set({ source: src, lineCount: src.split("\n").length })
        .where(eq(program.programId, pid))
        .returning({ id: program.id });
      results.push({ programId: pid, updated: rows.length > 0, length: src.length });
    }
    return NextResponse.json({ updated: results.length, results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "backfill failed" },
      { status: 500 },
    );
  }
}
