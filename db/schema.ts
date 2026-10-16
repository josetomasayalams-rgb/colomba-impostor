import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';
export const rooms = sqliteTable('rooms', {
  code: text('code').primaryKey(),
  data: text('data').notNull(),
  sessions: text('sessions').notNull(),
  expiresAt: integer('expires_at').notNull(),
  version: integer('version').notNull(),
}, table => [index('rooms_expiry').on(table.expiresAt)]);
export const presence = sqliteTable('presence', {
  code: text('code').notNull().references(() => rooms.code, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull(),
  lastSeen: integer('last_seen').notNull(),
}, table => [primaryKey({ columns: [table.code, table.memberId] }), index('presence_seen').on(table.lastSeen)]);
export const limits = sqliteTable('limits', {
  key: text('key').primaryKey(),
  n: integer('n').notNull(),
  until: integer('until').notNull(),
}, table => [index('limits_until').on(table.until)]);
