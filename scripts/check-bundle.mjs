#!/usr/bin/env node
// Checks that nothing meant for the server reached the files a browser downloads.
// Run it after a build: `npm run build && npm run check:bundle`. CI runs it on every pull request.
//
// It reads every text file under .next/static (the client build output) and looks for:
//   1. the names of the secret settings (a name in a client file means code that reads it was shipped),
//   2. the values of those settings, taken from the environment and from the .env files, when set,
//   3. the path of any module under src/server (source maps and module ids carry paths),
//   4. sentences that exist only in src/server source files. If one shows up in a client file, a
//      server module was bundled for the browser even though no path says so.
//
// Exit code 0: nothing found. 1: at least one hit. 2: the check could not run (no build, no sources).
// A secret value is never printed, only the name of the setting it belongs to.
//
// Usage: node scripts/check-bundle.mjs [--root <project folder>]

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const SECRET_NAMES = ["ANTHROPIC_API_KEY", "SUPABASE_SERVICE_ROLE_KEY", "MCP_TOKEN", "DEMO_COOKIE_SECRET"];
/** Shorter values would match ordinary text by accident. Real secrets are far longer. */
const MIN_SECRET_VALUE_LENGTH = 8;
/** Files that are not text. Everything else under .next/static is read. */
const BINARY_FILE = /\.(?:woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|ico|mp4|webm|mp3|wasm|br|gz)$/i;
const SOURCE_FILE = /\.(?:ts|tsx|mts|js|jsx|mjs)$/;
/** A server-only sentence: long, plain characters, several words. Short or word-like strings are too common to prove anything. */
const MIN_SENTENCE_LENGTH = 40;
const MIN_SENTENCE_SPACES = 3;

function fail(message) {
  console.error(`check-bundle: ${message}`);
  process.exit(2);
}

function projectRoot() {
  const flag = process.argv.indexOf("--root");
  if (flag === -1) return resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const value = process.argv[flag + 1];
  if (!value) fail("--root needs a folder.");
  return resolve(value);
}

/** Every file under a folder, as absolute paths. */
function filesUnder(folder) {
  const out = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) out.push(...filesUnder(path));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

const posix = (path) => path.split(sep).join("/");

/** KEY=value lines of an env file. Quotes around a value are removed. */
function readEnvFile(path) {
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) continue;
    const quoted = /^(["'])(.*)\1$/.exec(match[2]);
    values[match[1]] = quoted ? quoted[2] : match[2].replace(/\s+#.*$/, "");
  }
  return values;
}

/** The secret values to look for: { name, value, from } for each one that is set anywhere. */
function secretValues(root) {
  const sources = [{ from: "the environment", values: process.env }];
  for (const name of readdirSync(root)) {
    if (/^\.env(?:\..+)?$/.test(name) && name !== ".env.example" && statSync(join(root, name)).isFile()) {
      sources.push({ from: name, values: readEnvFile(join(root, name)) });
    }
  }
  const found = [];
  for (const { from, values } of sources) {
    for (const name of SECRET_NAMES) {
      const value = values[name];
      if (typeof value !== "string" || value.length < MIN_SECRET_VALUE_LENGTH) continue;
      if (!found.some((secret) => secret.value === value)) found.push({ name, value, from });
    }
  }
  return found;
}

/** String literals in a source file: quoted, on one line, plain printable characters, no escapes. */
function stringLiterals(source) {
  const code = source
    .split(/\r?\n/)
    .filter((line) => !/^\s*(?:\/\/|\/?\*)/.test(line))
    .join("\n");
  const literals = new Set();
  for (const match of code.matchAll(/"([ !#-\[\]-~]+)"|'([ -&(-\[\]-~]+)'|`([ -#%-\[\]-_a-~]+)`/g)) {
    literals.add(match[1] ?? match[2] ?? match[3]);
  }
  return literals;
}

/** Sentences that appear in src/server and nowhere else under src: [{ text, file }]. */
function serverOnlySentences(root, serverFiles) {
  const otherSources = filesUnder(join(root, "src"))
    .filter((path) => SOURCE_FILE.test(path) && !serverFiles.includes(path))
    .map((path) => readFileSync(path, "utf8"));
  const sentences = new Map();
  for (const path of serverFiles) {
    for (const text of stringLiterals(readFileSync(path, "utf8"))) {
      if (text.length < MIN_SENTENCE_LENGTH || text.split(" ").length <= MIN_SENTENCE_SPACES) continue;
      if (sentences.has(text) || otherSources.some((source) => source.includes(text))) continue;
      sentences.set(text, posix(relative(root, path)));
    }
  }
  return [...sentences].map(([text, file]) => ({ text, file }));
}

/** True when `needle` occurs in `text` other than inside the path of the Next.js package itself. */
function hasOwnPath(text, needle) {
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    if (!text.slice(Math.max(0, at - 5), at).endsWith("next/")) return true;
  }
  return false;
}

const root = projectRoot();
const staticDir = join(root, ".next", "static");
const serverDir = join(root, "src", "server");

if (!existsSync(staticDir)) {
  fail(`there is no client build at ${posix(relative(process.cwd(), staticDir)) || staticDir}. Run \`npm run build\` first, then \`npm run check:bundle\`.`);
}
if (!existsSync(serverDir)) fail(`${serverDir} does not exist. Run this from the project, or pass --root.`);

const clientFiles = filesUnder(staticDir).filter((path) => !BINARY_FILE.test(path));
if (!clientFiles.some((path) => /\.js$/.test(path))) {
  fail(".next/static holds no JavaScript, so there is nothing to check. Run `npm run build` again.");
}

const serverFiles = filesUnder(serverDir).filter((path) => SOURCE_FILE.test(path));
const serverPaths = serverFiles.map((path) => posix(relative(root, path)).replace(SOURCE_FILE, ""));
const secrets = secretValues(root);
const sentences = serverOnlySentences(root, serverFiles);

const hits = [];
let bytes = 0;
for (const path of clientFiles) {
  const text = readFileSync(path, "utf8");
  bytes += text.length;
  const file = posix(relative(root, path));
  for (const name of SECRET_NAMES) {
    if (text.includes(name)) hits.push({ file, what: `the name of a secret setting: ${name}` });
  }
  for (const secret of secrets) {
    if (text.includes(secret.value)) hits.push({ file, what: `the value of ${secret.name} (as set in ${secret.from})` });
  }
  for (const serverPath of serverPaths) {
    if (hasOwnPath(text, serverPath)) hits.push({ file, what: `a server module path: ${serverPath}` });
  }
  for (const sentence of sentences) {
    if (text.includes(sentence.text)) hits.push({ file, what: `text that exists only in ${sentence.file}: "${sentence.text.slice(0, 60)}${sentence.text.length > 60 ? "..." : ""}"` });
  }
}

const scanned = `${clientFiles.length} ${clientFiles.length === 1 ? "file" : "files"} (${(bytes / 1024 / 1024).toFixed(1)} MB) under .next/static`;
if (hits.length > 0) {
  console.error(`check-bundle: FAILED. ${hits.length} ${hits.length === 1 ? "hit" : "hits"} in ${scanned}.`);
  for (const hit of hits) console.error(`  ${hit.file}: contains ${hit.what}`);
  console.error("Server code or a secret reached the browser bundle. Find the client component that imports it (directly or through another module) and move the server part behind an API route.");
  process.exit(1);
}

console.log(
  `check-bundle: OK. ${scanned}: no secret setting names (${SECRET_NAMES.length} checked), no secret values (${secrets.length} set and checked), ` +
    `no src/server module paths (${serverPaths.length} checked), no server-only text (${sentences.length} sentences checked).`,
);
