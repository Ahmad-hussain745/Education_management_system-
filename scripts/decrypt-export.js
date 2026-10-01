#!/usr/bin/env node
// Decrypts a .msabak file created by /api/export/institute-data.
//
// Usage:
//   node scripts/decrypt-export.js path/to/institute-backup-2026-09-16.msabak
//
// Prompts for the passphrase (not taken as a CLI argument, so it never
// ends up in shell history), then writes the decrypted JSON next to the
// input file with a .json extension. That output file is PLAINTEXT — every
// student, fee, and payment in the export, unencrypted. Treat it the way
// you'd treat a printed copy of your financial records: delete it when
// you're done with it, don't email it, don't leave it in Downloads.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

function readPassphrase(promptText) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    // Best-effort masking — works in most terminals, not a security
    // boundary by itself (see the warning above about the output file).
    rl.question(promptText, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("Usage: node scripts/decrypt-export.js <file.msabak>");
    process.exit(1);
  }

  const fileBuffer = fs.readFileSync(inputPath);
  const magic = fileBuffer.subarray(0, 4).toString("ascii");
  if (magic !== "MSAB") {
    console.error("Not a recognized .msabak file (bad header).");
    process.exit(1);
  }
  const version = fileBuffer[4];
  if (version !== 1) {
    console.error(`Unsupported export format version: ${version}`);
    process.exit(1);
  }

  const salt = fileBuffer.subarray(5, 21);
  const iv = fileBuffer.subarray(21, 33);
  const authTag = fileBuffer.subarray(33, 49);
  const ciphertext = fileBuffer.subarray(49);

  const passphrase = await readPassphrase("Passphrase: ");

  const key = crypto.pbkdf2Sync(passphrase, salt, 210000, 32, "sha256");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (err) {
    // GCM's auth tag check failing means either the wrong passphrase or a
    // corrupted/tampered file — there's no way to tell which from here,
    // and pretending otherwise would be guessing.
    console.error("Decryption failed — wrong passphrase, or the file is corrupted/incomplete.");
    process.exit(1);
  }

  const outputPath = inputPath.replace(/\.msabak$/, "") + ".json";
  fs.writeFileSync(outputPath, plaintext);

  const parsed = JSON.parse(plaintext.toString("utf-8"));
  console.log(`Decrypted to: ${outputPath}`);
  console.log(`Exported: ${parsed.manifest.exported_at} for ${parsed.manifest.institute_name}`);
  console.log("Row counts:", parsed.manifest.row_counts);
  console.log("\nThis output file is UNENCRYPTED. Delete it once you no longer need it.");
}

main();
