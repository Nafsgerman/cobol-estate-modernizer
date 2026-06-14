-- =============================================================================
-- COBOL AI Advisor — Estate Modernization Knowledge Base
-- Target: PostgreSQL 16 (Aurora PostgreSQL Serverless v2 == Databricks Lakebase)
-- Portability: core PG16 only. No Aurora-specific extensions/functions.
--   gen_random_uuid() is core since PG13. Recursive CTEs use a path-array
--   cycle guard (works everywhere; no SEARCH/CYCLE dialect surprises).
-- =============================================================================

-- ---------- ENUMS (stable domains only) -------------------------------------
CREATE TYPE analysis_mode    AS ENUM ('explain', 'modernize', 'assess', 'extract', 'dependencies');
CREATE TYPE run_status       AS ENUM ('pending', 'streaming', 'complete', 'error');
CREATE TYPE node_type        AS ENUM ('program', 'copybook', 'data_element');
CREATE TYPE dependency_type  AS ENUM ('call', 'copy', 'uses_data', 'performs', 'reads_file', 'writes_file');
CREATE TYPE rule_category    AS ENUM ('validation', 'calculation', 'control_flow', 'io', 'other');
CREATE TYPE ticket_status    AS ENUM ('open', 'in_progress', 'blocked', 'done');
CREATE TYPE ticket_priority  AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE ticket_kind      AS ENUM ('refactor', 'rewrite', 'test', 'document', 'risk');

-- ---------- ROOT SCOPE ------------------------------------------------------
CREATE TABLE estate (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    description  text,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- PROGRAMS ---------------------------------------------------------
CREATE TABLE program (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id     uuid NOT NULL REFERENCES estate(id) ON DELETE CASCADE,
    program_id    text NOT NULL,                 -- COBOL PROGRAM-ID
    filename      text,
    is_subprogram boolean NOT NULL DEFAULT false,
    line_count    integer,
    source        text,                          -- raw COBOL (nullable; can live in S3)
    metadata      jsonb NOT NULL DEFAULT '{}',
    last_run_id   uuid,                           -- newest analysis_run; FK added post-hoc
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (estate_id, program_id)
);

-- ---------- COPYBOOKS --------------------------------------------------------
CREATE TABLE copybook (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   uuid NOT NULL REFERENCES estate(id) ON DELETE CASCADE,
    name        text NOT NULL,
    source      text,
    metadata    jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (estate_id, name)
);

-- ---------- DATA ELEMENTS (hierarchical; owned by program XOR copybook) ------
CREATE TABLE data_element (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id     uuid NOT NULL REFERENCES estate(id) ON DELETE CASCADE,
    program_id    uuid REFERENCES program(id)  ON DELETE CASCADE,
    copybook_id   uuid REFERENCES copybook(id) ON DELETE CASCADE,
    parent_id     uuid REFERENCES data_element(id) ON DELETE CASCADE,
    level_number  smallint NOT NULL,             -- 01..49, 66, 77, 88
    name          text NOT NULL,
    picture       text,                          -- PIC clause
    usage         text,                          -- DISPLAY / COMP / COMP-3 ...
    occurs        integer,                       -- array cardinality (OCCURS)
    redefines     text,
    value         text,                          -- literal / 88-level condition
    metadata      jsonb NOT NULL DEFAULT '{}',
    -- owned by exactly one container
    CONSTRAINT data_element_owner_xor
        CHECK ( (program_id IS NOT NULL)::int + (copybook_id IS NOT NULL)::int = 1 )
);

-- ---------- ANALYSIS RUNS (lineage spine) -----------------------------------
CREATE TABLE analysis_run (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id          uuid NOT NULL REFERENCES estate(id) ON DELETE CASCADE,
    program_id         uuid REFERENCES program(id) ON DELETE SET NULL,
    mode               analysis_mode NOT NULL,
    status             run_status NOT NULL DEFAULT 'pending',
    model              text NOT NULL,            -- e.g. claude-opus-4-8
    input_hash         text,                     -- dedupe identical analyses
    output             text,                     -- streamed Claude text
    output_json        jsonb,                    -- structured extraction payload
    prompt_tokens      integer,
    completion_tokens  integer,
    error              text,
    started_at         timestamptz NOT NULL DEFAULT now(),
    finished_at        timestamptz
);

-- program.last_run_id -> analysis_run (deferred FK, breaks the cycle above)
ALTER TABLE program
    ADD CONSTRAINT program_last_run_fk
    FOREIGN KEY (last_run_id) REFERENCES analysis_run(id) ON DELETE SET NULL;

-- ---------- BUSINESS RULES (extracted; trace back to the run) ---------------
CREATE TABLE business_rule (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id   uuid NOT NULL REFERENCES estate(id) ON DELETE CASCADE,
    program_id  uuid NOT NULL REFERENCES program(id) ON DELETE CASCADE,
    run_id      uuid REFERENCES analysis_run(id) ON DELETE SET NULL,
    statement   text NOT NULL,                   -- natural-language rule
    category    rule_category NOT NULL DEFAULT 'other',
    location    text,                            -- paragraph / line range
    confidence  numeric(3,2),                    -- 0.00..1.00
    metadata    jsonb NOT NULL DEFAULT '{}',
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- rule <-> data element references (powers "click node -> rules touching field")
CREATE TABLE business_rule_data_element (
    rule_id          uuid NOT NULL REFERENCES business_rule(id) ON DELETE CASCADE,
    data_element_id  uuid NOT NULL REFERENCES data_element(id) ON DELETE CASCADE,
    PRIMARY KEY (rule_id, data_element_id)
);

-- ---------- TICKETS (modernization work items) ------------------------------
CREATE TABLE ticket (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id    uuid NOT NULL REFERENCES estate(id) ON DELETE CASCADE,
    program_id   uuid REFERENCES program(id) ON DELETE SET NULL,
    run_id       uuid REFERENCES analysis_run(id) ON DELETE SET NULL,
    title        text NOT NULL,
    body         text,
    kind         ticket_kind NOT NULL DEFAULT 'refactor',
    status       ticket_status NOT NULL DEFAULT 'open',
    priority     ticket_priority NOT NULL DEFAULT 'medium',
    effort       text,                           -- t-shirt / points
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- DEPENDENCY EDGES (polymorphic, typed — the graph) ----------------
-- No real FK on source/target (PG has no polymorphic FK). Integrity enforced
-- by app + the partial indexes below; cleanup handled by ON DELETE on nodes
-- is intentionally NOT available here — purge edges in the same txn as nodes,
-- or run the GC query in queries/lineage.ts.
CREATE TABLE dependency (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    estate_id     uuid NOT NULL REFERENCES estate(id) ON DELETE CASCADE,
    source_type   node_type NOT NULL,
    source_id     uuid NOT NULL,
    target_type   node_type NOT NULL,
    target_id     uuid NOT NULL,
    kind          dependency_type NOT NULL,
    metadata      jsonb NOT NULL DEFAULT '{}',
    created_at    timestamptz NOT NULL DEFAULT now(),
    UNIQUE (estate_id, source_type, source_id, target_type, target_id, kind)
);

-- ---------- INDEXES ---------------------------------------------------------
CREATE INDEX idx_program_estate         ON program(estate_id);
CREATE INDEX idx_copybook_estate        ON copybook(estate_id);
CREATE INDEX idx_de_estate              ON data_element(estate_id);
CREATE INDEX idx_de_program             ON data_element(program_id);
CREATE INDEX idx_de_copybook            ON data_element(copybook_id);
CREATE INDEX idx_de_parent              ON data_element(parent_id);
CREATE INDEX idx_run_estate_program     ON analysis_run(estate_id, program_id);
CREATE INDEX idx_rule_program           ON business_rule(program_id);
CREATE INDEX idx_rule_run               ON business_rule(run_id);
CREATE INDEX idx_ticket_estate_status   ON ticket(estate_id, status);

-- graph traversal: outbound + inbound + the call-chain hot path
CREATE INDEX idx_dep_out  ON dependency(estate_id, source_type, source_id);
CREATE INDEX idx_dep_in   ON dependency(estate_id, target_type, target_id);
CREATE INDEX idx_dep_call ON dependency(estate_id, source_id, target_id)
    WHERE kind = 'call';
