#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");

function envOrDefault(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  return value;
}

function parseJsonOutput(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

async function main() {
  const root = path.resolve(__dirname, "..");
  const runner = path.resolve(__dirname, "reddit_to_seedance.js");
  const args = [
    runner,
    "--subreddit", envOrDefault("SUBREDDIT", "shortscarystories"),
    "--time", envOrDefault("REDDIT_TIME", "week"),
    "--limit", envOrDefault("REDDIT_LIMIT", "30"),
    "--mode", envOrDefault("PIAPI_MODE", "seedance-2-fast-preview"),
    "--target-seconds", envOrDefault("TARGET_SECONDS", "20"),
    "--scene-duration", envOrDefault("SCENE_DURATION", "5"),
    "--max-scenes", envOrDefault("MAX_SCENES", "4"),
    "--aspect", envOrDefault("ASPECT_RATIO", "16:9"),
    "--poll-seconds", envOrDefault("POLL_SECONDS", "8"),
    "--max-poll-minutes", envOrDefault("MAX_POLL_MINUTES", "20"),
    "--story-fallbacks", envOrDefault("STORY_FALLBACKS", "2"),
    "--daily-rotation",
    "--publish",
    "--publish-mode", envOrDefault("PUBLISH_MODE", "local"),
    "--output-dir", envOrDefault("OUTPUT_DIR", "outputs")
  ];

  if (envOrDefault("DRY_RUN", "false") === "true") {
    args.push("--dry-run");
  }

  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, stdout, stderr }));
  });

  const parsed = parseJsonOutput(result.stdout);
  const outDir = path.resolve(root, envOrDefault("OUTPUT_DIR", "outputs"));
  await fs.mkdir(outDir, { recursive: true });
  const runPath = path.join(outDir, "latest-run.json");
  await fs.writeFile(
    runPath,
    `${JSON.stringify({
      finished_at: new Date().toISOString(),
      exit_code: result.code,
      parsed,
      stderr_preview: result.stderr.slice(-2000)
    }, null, 2)}\n`,
    "utf8"
  );

  if (result.code !== 0) {
    process.exit(result.code || 1);
  }
}

main().catch((error) => {
  process.stderr.write(`daily_scary_story failed: ${error.message}\n`);
  process.exit(1);
});
