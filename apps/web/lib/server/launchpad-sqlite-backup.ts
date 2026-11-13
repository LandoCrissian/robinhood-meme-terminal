import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, copyFileSync, createReadStream, existsSync, fsyncSync, linkSync, lstatSync, openSync, unlinkSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const maximumBackupBytes = 256 * 1024 * 1024;

export async function launchBackupEvidence<T>(path: string, checkpoint?: T) {
  const info = lstatSync(path);
  const { size } = info;
  if (!info.isFile() || size < 512 || size > maximumBackupBytes) throw new Error("Invalid launch backup file size or type");
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path, { end: maximumBackupBytes })) {
    bytes += chunk.length;
    digest.update(chunk);
  }
  if (bytes !== size || bytes > maximumBackupBytes) throw new Error("Launch backup size changed during verification");
  return { bytes, sha256: digest.digest("hex"), checkpoint };
}

export async function copyLaunchSnapshot(sourcePath: string, staged: string) {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    source.exec("PRAGMA busy_timeout=2500; PRAGMA trusted_schema=OFF; BEGIN");
    const pages = Number(source.prepare("PRAGMA page_count").get()?.page_count);
    const pageSize = Number(source.prepare("PRAGMA page_size").get()?.page_size);
    if (!Number.isSafeInteger(pages * pageSize) || pages * pageSize > maximumBackupBytes) {
      throw new Error("Launch database exceeds the backup size limit");
    }
    await backup(source, staged);
  } finally { source.close(); }
}

export async function copyVerifiedLaunchBackup(source: string, staged: string, expectedSha256: string) {
  if (!isAbsolute(source) || !/^[a-f0-9]{64}$/i.test(expectedSha256)) {
    throw new Error("Launch restore requires an absolute source and its recorded SHA-256");
  }
  const sourceFile = lstatSync(source);
  if (!sourceFile.isFile() || sourceFile.size > maximumBackupBytes) throw new Error("Invalid launch backup file size or type");
  // Hash the staged copy before opening it as SQLite. No source sidecars are copied.
  copyFileSync(source, staged, constants.COPYFILE_FICLONE);
  if ((await launchBackupEvidence(staged)).sha256 !== expectedSha256.toLowerCase()) throw new Error("Launch backup SHA-256 mismatch");
}

export async function stageLaunchBackup<T>(destination: string, prepare: (staged: string) => Promise<T>) {
  if (!isAbsolute(destination) || ["", "-wal", "-shm", "-journal"].some((suffix) => existsSync(destination + suffix))) {
    throw new Error("Launch backup destination must be a fresh absolute file without SQLite sidecars");
  }
  const staged = join(dirname(destination), `.rmt-launch-backup-${randomUUID()}.sqlite`);
  closeSync(openSync(staged, "wx", 0o600));
  try {
    const checkpoint = await prepare(staged);
    const result = await launchBackupEvidence(staged, checkpoint);
    const file = openSync(staged, "r+");
    try { fsyncSync(file); } finally { closeSync(file); }
    // The hard link publishes the verified snapshot atomically and fails if the destination already exists.
    linkSync(staged, destination);
    if (process.platform !== "win32") {
      const directory = openSync(dirname(destination), "r");
      try { fsyncSync(directory); } finally { closeSync(directory); }
    }
    return result;
  } finally {
    for (const path of [staged, staged + "-wal", staged + "-shm", staged + "-journal"]) {
      if (existsSync(path)) unlinkSync(path);
    }
  }
}
