// =============================================================================
// db/schema.ts — Drizzle schema for the COBOL estate graph
// PG16 / Aurora == Lakebase. Mirrors schema.sql 1:1.
// =============================================================================
import {
  pgTable, pgEnum, uuid, text, integer, smallint, boolean, numeric,
  jsonb, timestamp, primaryKey, unique, index, check, foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ---------- enums -----------------------------------------------------------
export const analysisMode = pgEnum('analysis_mode', ['explain', 'modernize', 'assess', 'extract', 'dependencies']);
export const runStatus      = pgEnum('run_status',      ['pending', 'streaming', 'complete', 'error']);
export const nodeType       = pgEnum('node_type',       ['program', 'copybook', 'data_element']);
export const dependencyType = pgEnum('dependency_type', ['call', 'copy', 'uses_data', 'performs', 'reads_file', 'writes_file']);
export const ruleCategory   = pgEnum('rule_category',   ['validation', 'calculation', 'control_flow', 'io', 'other']);
export const ticketStatus   = pgEnum('ticket_status',   ['open', 'in_progress', 'blocked', 'done']);
export const ticketPriority = pgEnum('ticket_priority', ['low', 'medium', 'high', 'critical']);
export const ticketKind     = pgEnum('ticket_kind',     ['refactor', 'rewrite', 'test', 'document', 'risk']);

// ---------- estate ----------------------------------------------------------
export const estate = pgTable('estate', {
  id:          uuid('id').primaryKey().defaultRandom(),
  name:        text('name').notNull(),
  description: text('description'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- program ---------------------------------------------------------
export const program = pgTable('program', {
  id:           uuid('id').primaryKey().defaultRandom(),
  estateId:     uuid('estate_id').notNull().references(() => estate.id, { onDelete: 'cascade' }),
  programId:    text('program_id').notNull(),
  filename:     text('filename'),
  isSubprogram: boolean('is_subprogram').notNull().default(false),
  lineCount:    integer('line_count'),
  source:       text('source'),
  metadata:     jsonb('metadata').notNull().default({}),
  // self-referential-ish FK to analysis_run; typed loosely to dodge cycle, see relations
  lastRunId:    uuid('last_run_id'),
  createdAt:    timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  unique('program_estate_program_id').on(t.estateId, t.programId),
  index('idx_program_estate').on(t.estateId),
  foreignKey({ columns: [t.lastRunId], foreignColumns: [analysisRun.id], name: 'program_last_run_fk' }).onDelete('set null'),
]));

// ---------- copybook --------------------------------------------------------
export const copybook = pgTable('copybook', {
  id:        uuid('id').primaryKey().defaultRandom(),
  estateId:  uuid('estate_id').notNull().references(() => estate.id, { onDelete: 'cascade' }),
  name:      text('name').notNull(),
  source:    text('source'),
  metadata:  jsonb('metadata').notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  unique('copybook_estate_name').on(t.estateId, t.name),
  index('idx_copybook_estate').on(t.estateId),
]));

// ---------- data_element (hierarchical, owned by program XOR copybook) -------
export const dataElement = pgTable('data_element', {
  id:          uuid('id').primaryKey().defaultRandom(),
  estateId:    uuid('estate_id').notNull().references(() => estate.id, { onDelete: 'cascade' }),
  programId:   uuid('program_id').references(() => program.id, { onDelete: 'cascade' }),
  copybookId:  uuid('copybook_id').references(() => copybook.id, { onDelete: 'cascade' }),
  parentId:    uuid('parent_id').references((): AnyPgColumn => dataElement.id, { onDelete: 'cascade' }),
  levelNumber: smallint('level_number').notNull(),
  name:        text('name').notNull(),
  picture:     text('picture'),
  usage:       text('usage'),
  occurs:      integer('occurs'),
  redefines:   text('redefines'),
  value:       text('value'),
  metadata:    jsonb('metadata').notNull().default({}),
}, (t) => ([
  check('data_element_owner_xor',
    sql`(${t.programId} IS NOT NULL)::int + (${t.copybookId} IS NOT NULL)::int = 1`),
  index('idx_de_estate').on(t.estateId),
  index('idx_de_program').on(t.programId),
  index('idx_de_copybook').on(t.copybookId),
  index('idx_de_parent').on(t.parentId),
]));

// ---------- analysis_run (lineage spine) ------------------------------------
export const analysisRun = pgTable('analysis_run', {
  id:               uuid('id').primaryKey().defaultRandom(),
  estateId:         uuid('estate_id').notNull().references(() => estate.id, { onDelete: 'cascade' }),
  programId:        uuid('program_id').references(() => program.id, { onDelete: 'set null' }),
  mode:             analysisMode('mode').notNull(),
  status:           runStatus('status').notNull().default('pending'),
  model:            text('model').notNull(),
  inputHash:        text('input_hash'),
  output:           text('output'),
  outputJson:       jsonb('output_json'),
  promptTokens:     integer('prompt_tokens'),
  completionTokens: integer('completion_tokens'),
  error:            text('error'),
  startedAt:        timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt:       timestamp('finished_at', { withTimezone: true }),
}, (t) => ([
  index('idx_run_estate_program').on(t.estateId, t.programId),
]));

// ---------- business_rule ---------------------------------------------------
export const businessRule = pgTable('business_rule', {
  id:         uuid('id').primaryKey().defaultRandom(),
  estateId:   uuid('estate_id').notNull().references(() => estate.id, { onDelete: 'cascade' }),
  programId:  uuid('program_id').notNull().references(() => program.id, { onDelete: 'cascade' }),
  runId:      uuid('run_id').references(() => analysisRun.id, { onDelete: 'set null' }),
  statement:  text('statement').notNull(),
  category:   ruleCategory('category').notNull().default('other'),
  location:   text('location'),
  confidence: numeric('confidence', { precision: 3, scale: 2 }),
  metadata:   jsonb('metadata').notNull().default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  index('idx_rule_program').on(t.programId),
  index('idx_rule_run').on(t.runId),
]));

export const businessRuleDataElement = pgTable('business_rule_data_element', {
  ruleId:        uuid('rule_id').notNull().references(() => businessRule.id, { onDelete: 'cascade' }),
  dataElementId: uuid('data_element_id').notNull().references(() => dataElement.id, { onDelete: 'cascade' }),
}, (t) => ([
  primaryKey({ columns: [t.ruleId, t.dataElementId] }),
]));

// ---------- ticket ----------------------------------------------------------
export const ticket = pgTable('ticket', {
  id:        uuid('id').primaryKey().defaultRandom(),
  estateId:  uuid('estate_id').notNull().references(() => estate.id, { onDelete: 'cascade' }),
  programId: uuid('program_id').references(() => program.id, { onDelete: 'set null' }),
  runId:     uuid('run_id').references(() => analysisRun.id, { onDelete: 'set null' }),
  title:     text('title').notNull(),
  body:      text('body'),
  kind:      ticketKind('kind').notNull().default('refactor'),
  status:    ticketStatus('status').notNull().default('open'),
  priority:  ticketPriority('priority').notNull().default('medium'),
  effort:    text('effort'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  index('idx_ticket_estate_status').on(t.estateId, t.status),
]));

// ---------- dependency (polymorphic typed edges) ----------------------------
export const dependency = pgTable('dependency', {
  id:         uuid('id').primaryKey().defaultRandom(),
  estateId:   uuid('estate_id').notNull().references(() => estate.id, { onDelete: 'cascade' }),
  sourceType: nodeType('source_type').notNull(),
  sourceId:   uuid('source_id').notNull(),
  targetType: nodeType('target_type').notNull(),
  targetId:   uuid('target_id').notNull(),
  kind:       dependencyType('kind').notNull(),
  metadata:   jsonb('metadata').notNull().default({}),
  createdAt:  timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ([
  unique('dependency_edge_uq').on(t.estateId, t.sourceType, t.sourceId, t.targetType, t.targetId, t.kind),
  index('idx_dep_out').on(t.estateId, t.sourceType, t.sourceId),
  index('idx_dep_in').on(t.estateId, t.targetType, t.targetId),
]));

// ---------- relations (Drizzle query API) -----------------------------------
export const estateRelations = relations(estate, ({ many }) => ({
  programs: many(program), copybooks: many(copybook), runs: many(analysisRun),
  rules: many(businessRule), tickets: many(ticket), dependencies: many(dependency),
}));

export const programRelations = relations(program, ({ one, many }) => ({
  estate:       one(estate, { fields: [program.estateId], references: [estate.id] }),
  lastRun:      one(analysisRun, { fields: [program.lastRunId], references: [analysisRun.id] }),
  dataElements: many(dataElement),
  runs:         many(analysisRun),
  rules:        many(businessRule),
  tickets:      many(ticket),
}));

export const copybookRelations = relations(copybook, ({ one, many }) => ({
  estate: one(estate, { fields: [copybook.estateId], references: [estate.id] }),
  dataElements: many(dataElement),
}));

export const dataElementRelations = relations(dataElement, ({ one, many }) => ({
  estate:   one(estate, { fields: [dataElement.estateId], references: [estate.id] }),
  program:  one(program, { fields: [dataElement.programId], references: [program.id] }),
  copybook: one(copybook, { fields: [dataElement.copybookId], references: [copybook.id] }),
  parent:   one(dataElement, { fields: [dataElement.parentId], references: [dataElement.id], relationName: 'de_tree' }),
  children: many(dataElement, { relationName: 'de_tree' }),
  ruleLinks: many(businessRuleDataElement),
}));

export const analysisRunRelations = relations(analysisRun, ({ one, many }) => ({
  estate:  one(estate, { fields: [analysisRun.estateId], references: [estate.id] }),
  program: one(program, { fields: [analysisRun.programId], references: [program.id] }),
  rules:   many(businessRule),
  tickets: many(ticket),
}));

export const businessRuleRelations = relations(businessRule, ({ one, many }) => ({
  estate:  one(estate, { fields: [businessRule.estateId], references: [estate.id] }),
  program: one(program, { fields: [businessRule.programId], references: [program.id] }),
  run:     one(analysisRun, { fields: [businessRule.runId], references: [analysisRun.id] }),
  dataElementLinks: many(businessRuleDataElement),
}));

export const businessRuleDataElementRelations = relations(businessRuleDataElement, ({ one }) => ({
  rule:        one(businessRule, { fields: [businessRuleDataElement.ruleId], references: [businessRule.id] }),
  dataElement: one(dataElement, { fields: [businessRuleDataElement.dataElementId], references: [dataElement.id] }),
}));

export const ticketRelations = relations(ticket, ({ one }) => ({
  estate:  one(estate, { fields: [ticket.estateId], references: [estate.id] }),
  program: one(program, { fields: [ticket.programId], references: [program.id] }),
  run:     one(analysisRun, { fields: [ticket.runId], references: [analysisRun.id] }),
}));
