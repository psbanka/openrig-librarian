// The rig's data directory and its index. Everything here is owner-only.
import { Database, constants } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface Store {
  db: Database;
  dir: string;
  rig: string;
}

const SCHEMA = `
create table if not exists items (
  ref text primary key,
  kind text not null,
  title text not null,
  date text not null,
  version text not null,
  state text,
  authority integer not null
);
create table if not exists chunks (
  id integer primary key,
  ref text not null references items (ref),
  seq integer not null,
  title text not null,
  text text not null
);
create index if not exists chunks_by_ref on chunks (ref);
create virtual table if not exists fts using fts5 (
  title, text, content = 'chunks', content_rowid = 'id', tokenize = 'porter unicode61'
);
`;

/** `${XDG_DATA_HOME:-~/.local/share}/openrig-librarian/<rig>`, created owner-only. */
export function dataDir(rig: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(rig)) throw new Error(`rig must be kebab-case, got ${JSON.stringify(rig)}`);
  const dir = join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "openrig-librarian", rig);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

export function openStore(rig: string): Store {
  const dir = dataDir(rig);
  const path = join(dir, "index.db");
  const db = new Database(path, { create: true });
  // Before WAL starts: SQLite gives its -wal and -shm files the database file's mode.
  chmodSync(path, 0o600);
  db.run("pragma journal_mode = wal");
  // macOS's system SQLite keeps -wal and -shm after the last close; this lets close remove them.
  db.fileControl(constants.SQLITE_FCNTL_PERSIST_WAL, 0);
  db.run("pragma foreign_keys = on");
  db.run("pragma temp_store = memory");
  db.run(SCHEMA);
  return { db, dir, rig };
}
