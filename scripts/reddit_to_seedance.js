#!/usr/bin/env node
"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

const PIAPI_BASE_URL = "https://api.piapi.ai";
const REDDIT_BASE_URL = "https://www.reddit.com";
const REDDIT_USER_AGENT = "piapi-exp-script/1.0";
const DEFAULTS = {
  subreddit: "shortscarystories",
  limit: 30,
  duration: 5,
  targetSeconds: 5,
  sceneDuration: 5,
  maxScenes: 6,
  aspect: "16:9",
  time: "week",
  mode: "seedance-2-fast-preview",
  pollSeconds: 8,
  maxPollMinutes: 20,
  storyFallbacks: 1,
  publish: false,
  publishMode: "local",
  outputDir: "outputs",
  publishWebhookUrl: "",
  dailyRotation: false,
  dryRun: false
};

function logPhase(phase, message) {
  const now = new Date().toISOString();
  process.stderr.write(`[${now}] [${phase}] ${message}\n`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const args = { ...DEFAULTS, _targetProvided: false, _sceneProvided: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      continue;
    }

    const [rawKey, inlineValue] = token.slice(2).split("=", 2);
    const key = rawKey.trim();
    let value = inlineValue;
    if (value === undefined) {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        value = next;
        i += 1;
      } else {
        value = "true";
      }
    }

    switch (key) {
      case "subreddit":
        args.subreddit = value;
        break;
      case "limit":
        args.limit = Number(value);
        break;
      case "duration":
        args.duration = Number(value);
        if (!args._targetProvided) {
          args.targetSeconds = Number(value);
        }
        if (!args._sceneProvided) {
          args.sceneDuration = Number(value);
        }
        break;
      case "target-seconds":
        args.targetSeconds = Number(value);
        args._targetProvided = true;
        break;
      case "scene-duration":
        args.sceneDuration = Number(value);
        args._sceneProvided = true;
        break;
      case "max-scenes":
        args.maxScenes = Number(value);
        break;
      case "aspect":
        args.aspect = value;
        break;
      case "time":
        args.time = value;
        break;
      case "mode":
        args.mode = value;
        break;
      case "poll-seconds":
        args.pollSeconds = Number(value);
        break;
      case "max-poll-minutes":
        args.maxPollMinutes = Number(value);
        break;
      case "story-fallbacks":
        args.storyFallbacks = Number(value);
        break;
      case "publish":
        args.publish = value !== "false";
        break;
      case "publish-mode":
        args.publishMode = value;
        break;
      case "output-dir":
        args.outputDir = value;
        break;
      case "publish-webhook-url":
        args.publishWebhookUrl = value;
        break;
      case "daily-rotation":
        args.dailyRotation = value !== "false";
        break;
      case "api-key":
        args.apiKey = value;
        break;
      case "dry-run":
        args.dryRun = value !== "false";
        break;
      case "help":
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown flag: --${key}`);
    }
  }

  if (!Number.isFinite(args.limit) || args.limit < 1 || args.limit > 100) {
    throw new Error("--limit must be between 1 and 100");
  }
  if (!Number.isFinite(args.duration) || args.duration < 1 || args.duration > 10) {
    throw new Error("--duration must be between 1 and 10");
  }
  if (!Number.isFinite(args.targetSeconds) || args.targetSeconds < 1 || args.targetSeconds > 120) {
    throw new Error("--target-seconds must be between 1 and 120");
  }
  if (!Number.isFinite(args.sceneDuration) || args.sceneDuration < 1 || args.sceneDuration > 10) {
    throw new Error("--scene-duration must be between 1 and 10");
  }
  if (!Number.isFinite(args.maxScenes) || args.maxScenes < 1 || args.maxScenes > 20) {
    throw new Error("--max-scenes must be between 1 and 20");
  }
  if (!/^\d+:\d+$/.test(args.aspect)) {
    throw new Error("--aspect must look like 16:9 or 9:16");
  }
  if (!Number.isFinite(args.pollSeconds) || args.pollSeconds < 2) {
    throw new Error("--poll-seconds must be >= 2");
  }
  if (!Number.isFinite(args.maxPollMinutes) || args.maxPollMinutes < 1) {
    throw new Error("--max-poll-minutes must be >= 1");
  }
  if (!Number.isFinite(args.storyFallbacks) || args.storyFallbacks < 0 || args.storyFallbacks > 5) {
    throw new Error("--story-fallbacks must be between 0 and 5");
  }
  if (!["local", "webhook", "both"].includes(args.publishMode)) {
    throw new Error("--publish-mode must be one of: local, webhook, both");
  }
  if (args.sceneDuration > args.targetSeconds) {
    args.sceneDuration = args.targetSeconds;
  }

  delete args._targetProvided;
  delete args._sceneProvided;

  return args;
}

function printHelp() {
  const help = `
Usage:
  node scripts/reddit_to_seedance.js [options]

Options:
  --subreddit <name>          Subreddit to read (default: shortscarystories)
  --limit <n>                 Number of Reddit posts to fetch (default: 30)
  --time <hour|day|week|month|year|all>   Reddit top time window (default: week)
  --duration <n>              Seedance clip duration seconds (default: 5)
  --target-seconds <n>        Total target runtime across all scenes (default: duration)
  --scene-duration <n>        Seconds per generated scene clip (default: duration)
  --max-scenes <n>            Maximum number of scenes to generate (default: 6)
  --aspect <ratio>            Aspect ratio (default: 16:9)
  --mode <taskType>           PiAPI Seedance task type (default: seedance-2-fast-preview)
  --poll-seconds <n>          Poll interval seconds (default: 8)
  --max-poll-minutes <n>      Poll timeout minutes (default: 20)
  --story-fallbacks <n>       Extra stories to try after first fails (default: 1)
  --daily-rotation            Pick daily story by date index instead of always highest score
  --publish                   Publish output after successful generation
  --publish-mode <mode>       local | webhook | both (default: local)
  --output-dir <path>         Output directory for local publish artifacts (default: outputs)
  --publish-webhook-url <url> Optional webhook URL (or PUBLISH_WEBHOOK_URL env var)
  --api-key <key>             PiAPI key (preferred: PIAPI_KEY env var)
  --dry-run                   Skip PiAPI call and print selected story + prompt package
  --help                      Show this message
`;
  process.stdout.write(help.trimStart());
}

function normalizeWhitespace(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function truncate(input, maxChars) {
  const clean = normalizeWhitespace(input);
  if (clean.length <= maxChars) {
    return clean;
  }
  return `${clean.slice(0, maxChars - 3).trim()}...`;
}

function splitSentences(input) {
  return normalizeWhitespace(input)
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function maskKey(key) {
  if (!key) return "";
  const tail = key.slice(-4);
  return `****${tail}`;
}

function sanitizeForPg13(input) {
  const replacements = [
    [/\bgore\b/gi, "horror"],
    [/\bgory\b/gi, "disturbing"],
    [/\bblood\b/gi, "dark stain"],
    [/\bdisembowel(?:ed|ment)?\b/gi, "injured"],
    [/\bdecapitat(?:e|ed|ion)\b/gi, "attacked"],
    [/\bcorpse\b/gi, "body"],
    [/\bskull\b/gi, "face"],
    [/\bintestines?\b/gi, "damage"],
    [/\bripped open\b/gi, "wounded"]
  ];

  let output = String(input || "");
  for (const [pattern, replacement] of replacements) {
    output = output.replace(pattern, replacement);
  }
  return normalizeWhitespace(output);
}

function regexAny(text, keywords) {
  return keywords.some((word) => new RegExp(`\\b${word}\\b`, "i").test(text));
}

function dialogueRatio(text) {
  if (!text) return 0;
  const quotedChars = (text.match(/"[^"]+"/g) || []).reduce((sum, chunk) => sum + chunk.length, 0);
  return quotedChars / Math.max(1, text.length);
}

function firstPersonRatio(text) {
  const words = normalizeWhitespace(text).toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const firstPersonWords = words.filter((word) => ["i", "me", "my", "mine", "myself"].includes(word)).length;
  return firstPersonWords / words.length;
}

function isPromotional(post) {
  const blob = `${post.title || ""} ${post.selftext || ""}`.toLowerCase();
  return /(subscribe|youtube|instagram|tiktok|my channel|support me|patreon|linktr\.ee|check out my)/i.test(blob);
}

function scoreStory(post) {
  const combined = normalizeWhitespace(`${post.title || ""} ${post.selftext || ""}`);
  const settingWords = [
    "house", "basement", "attic", "hallway", "bedroom", "hospital", "school",
    "forest", "woods", "apartment", "motel", "store", "parking", "church", "office"
  ];
  const actionWords = [
    "opened", "heard", "saw", "ran", "walked", "stopped", "called",
    "turned", "locked", "hid", "followed", "screamed", "found", "watched"
  ];
  const twistWords = [
    "realized", "turns out", "except", "until", "then i saw", "was me",
    "mirror", "behind me", "not alone", "already dead", "never left"
  ];

  let score = 0;
  const reasons = [];

  if (regexAny(combined, settingWords)) {
    score += 2;
    reasons.push("clear setting");
  }
  if (regexAny(combined, actionWords)) {
    score += 2;
    reasons.push("action progression");
  }
  if (regexAny(combined, twistWords)) {
    score += 2;
    reasons.push("twist potential");
  }

  const textLength = (post.selftext || "").length;
  if (textLength >= 400 && textLength <= 1800) {
    score += 2;
    reasons.push("compact length");
  } else if (textLength > 2600) {
    score -= 2;
    reasons.push("too long");
  }

  const upvoteBoost = Math.min(4, (Number(post.ups) || 0) / 250);
  score += upvoteBoost;
  if (upvoteBoost > 0) {
    reasons.push("community signal");
  }

  const dRatio = dialogueRatio(post.selftext || "");
  if (dRatio > 0.18) {
    score -= 2;
    reasons.push("dialogue-heavy");
  }

  const fpRatio = firstPersonRatio(post.selftext || "");
  if (fpRatio > 0.1) {
    score -= 1;
    reasons.push("high internal narration");
  }

  return {
    score: Number(score.toFixed(2)),
    reasons
  };
}

function buildBeatOutline(storyText) {
  const sentences = splitSentences(storyText).filter((s) => s.length >= 25);
  if (sentences.length === 0) {
    return [
      "Establish an ordinary, quiet environment.",
      "Introduce a subtle disturbing detail.",
      "Escalate tension with a sudden shift in behavior.",
      "Reveal the source of dread in one sharp visual beat.",
      "Hold on an uneasy final image before cutting to black."
    ];
  }

  const indexTargets = [0, 0.2, 0.45, 0.7, 0.9];
  const picked = [];
  for (const fraction of indexTargets) {
    const idx = Math.round((sentences.length - 1) * fraction);
    const selected = sentences[Math.max(0, Math.min(idx, sentences.length - 1))];
    if (selected && !picked.includes(selected)) {
      picked.push(selected);
    }
  }

  while (picked.length < 5) {
    picked.push(picked[picked.length - 1] || sentences[0]);
  }

  return picked.slice(0, 5).map((line) => truncate(sanitizeForPg13(line), 130));
}

function dedupe(items) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = normalizeWhitespace(item).toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(normalizeWhitespace(item));
  }
  return output;
}

function pickSceneSentences(storyText, sceneCount) {
  const sentences = splitSentences(storyText).filter((s) => s.length >= 20);
  if (!sentences.length) {
    return [];
  }

  const withScores = sentences.map((sentence, idx) => {
    let score = 0;
    if (/\b(door|window|hallway|basement|kitchen|forest|room|stairs)\b/i.test(sentence)) score += 1.2;
    if (/\b(saw|heard|opened|turned|ran|walked|stopped|locked|hid|followed|found)\b/i.test(sentence)) score += 1.5;
    if (/\b(suddenly|then|until|except|behind|realized|whisper|shadow|cold)\b/i.test(sentence)) score += 1.4;
    if (idx === 0) score += 1.2;
    if (idx === sentences.length - 1) score += 1.8;
    if (sentence.length > 180) score -= 0.7;
    return { idx, sentence, score };
  });

  const sorted = [...withScores].sort((a, b) => b.score - a.score);
  const selected = sorted.slice(0, Math.min(sceneCount * 2, sorted.length)).sort((a, b) => a.idx - b.idx);
  const distilled = selected.map((s) => s.sentence);
  const unique = dedupe(distilled);

  if (unique.length >= sceneCount) {
    const result = [];
    for (let i = 0; i < sceneCount; i += 1) {
      const idx = Math.round((unique.length - 1) * (i / Math.max(sceneCount - 1, 1)));
      result.push(unique[idx]);
    }
    return dedupe(result).slice(0, sceneCount);
  }

  const fallback = dedupe(sentences);
  while (fallback.length < sceneCount) {
    fallback.push(fallback[fallback.length - 1] || sentences[0]);
  }
  return fallback.slice(0, sceneCount);
}

function buildScenePlan(storyText, targetSeconds, sceneDuration) {
  const sceneCount = Math.max(1, Math.ceil(targetSeconds / sceneDuration));
  const chosenSentences = pickSceneSentences(storyText, sceneCount);
  const sceneTexts = chosenSentences.length ? chosenSentences : buildBeatOutline(storyText);

  const scenes = [];
  let elapsed = 0;
  for (let i = 0; i < sceneCount; i += 1) {
    const remaining = targetSeconds - elapsed;
    const seconds = i === sceneCount - 1 ? remaining : Math.min(sceneDuration, remaining);
    const line = sanitizeForPg13(sceneTexts[Math.min(i, sceneTexts.length - 1)]);
    const phase = i === 0 ? "setup" : (i === sceneCount - 1 ? "twist" : "escalation");

    scenes.push({
      scene_index: i + 1,
      total_scenes: sceneCount,
      phase,
      seconds,
      start_sec: elapsed,
      end_sec: elapsed + seconds,
      scene_line: truncate(line, 180)
    });
    elapsed += seconds;
  }

  return scenes;
}

function buildScenePrompt({ title, hookLine, scene, styleTokens, negativeConstraints }) {
  return truncate(
    [
      `PG-13 cinematic horror scene ${scene.scene_index}/${scene.total_scenes}.`,
      `Story title: ${title}.`,
      `Context: ${hookLine}.`,
      `Current action: ${scene.scene_line}.`,
      `Tone: tense, immersive, realistic.`,
      `Camera and look: ${styleTokens.join(", ")}.`,
      `Constraints: ${negativeConstraints.join(", ")}.`
    ].join(" "),
    600
  );
}

function buildSceneRetryPrompt({ hookLine, scene }) {
  return truncate(
    [
      `PG-13 horror shot, scene ${scene.scene_index}/${scene.total_scenes}.`,
      `Action: ${scene.scene_line}.`,
      `Simple realistic scene, moody lighting, slow camera movement, 4k.`,
      `Context: ${hookLine}.`,
      `No gore, no text, no logo, no watermark.`
    ].join(" "),
    420
  );
}

function buildScriptPackage(post, args) {
  const title = sanitizeForPg13(post.title || "Unnamed short horror story");
  const cleanText = sanitizeForPg13(post.selftext || "");
  const sentences = splitSentences(cleanText);
  const hookSource = sentences[0] || title;
  const hookLine = truncate(hookSource, 140);
  const beatOutline = buildBeatOutline(cleanText);

  const styleTokens = [
    "cinematic lighting",
    "slow dolly movement",
    "shallow depth of field",
    "high contrast shadows",
    "subtle film grain",
    "realistic textures",
    "4k look"
  ];
  const negativeConstraints = [
    "no gore",
    "no graphic violence",
    "no text overlay",
    "no subtitles",
    "no logo",
    "no watermark"
  ];

  const totalSeconds = Math.min(args.targetSeconds, args.maxScenes * args.sceneDuration);
  const scenePlan = buildScenePlan(cleanText, totalSeconds, args.sceneDuration)
    .slice(0, args.maxScenes)
    .map((scene) => ({
      ...scene,
      prompt: buildScenePrompt({
        title,
        hookLine,
        scene,
        styleTokens,
        negativeConstraints
      }),
      retry_prompt: buildSceneRetryPrompt({
        hookLine,
        scene
      })
    }));

  return {
    hook_line: hookLine,
    beat_outline: beatOutline,
    scene_plan: scenePlan,
    seedance_prompt: scenePlan[0] ? scenePlan[0].prompt : "",
    retry_prompt: scenePlan[0] ? scenePlan[0].retry_prompt : "",
    negative_constraints: negativeConstraints,
    style_tokens: styleTokens,
    total_target_seconds: totalSeconds
  };
}

async function fetchJson(url, options = {}, label = "request") {
  const maxAttempts = options.maxAttempts || 4;
  const isPiapi = Boolean(options.isPiapi);
  const method = options.method || "GET";
  const headers = options.headers || {};
  const body = options.body || undefined;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, { method, headers, body });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch (parseErr) {
        if (!response.ok) {
          throw new Error(`${label} failed with status ${response.status}: ${truncate(text, 220)}`);
        }
        throw new Error(`${label} returned non-JSON payload`);
      }

      if (!response.ok) {
        if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
          await sleep(1000 * (2 ** (attempt - 1)));
          continue;
        }
        throw new Error(`${label} failed with status ${response.status}: ${truncate(text, 220)}`);
      }

      if (isPiapi && json && Number(json.code) !== 200) {
        const code = Number(json.code);
        if (code === 429 && attempt < maxAttempts) {
          await sleep(1000 * (2 ** (attempt - 1)));
          continue;
        }
        throw new Error(`${label} failed with piapi code ${json.code}: ${truncate(JSON.stringify(json), 220)}`);
      }

      return json;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(1000 * (2 ** (attempt - 1)));
        continue;
      }
    }
  }

  throw lastError || new Error(`${label} failed`);
}

async function fetchRedditPosts(args) {
  const url = `${REDDIT_BASE_URL}/r/${encodeURIComponent(args.subreddit)}/top.json?t=${encodeURIComponent(args.time)}&limit=${args.limit}&raw_json=1`;
  const json = await fetchJson(
    url,
    {
      headers: {
        "User-Agent": REDDIT_USER_AGENT,
        Accept: "application/json"
      },
      maxAttempts: 4
    },
    "fetch_reddit"
  );

  const children = (((json || {}).data || {}).children || []).map((child) => child.data).filter(Boolean);
  if (!children.length) {
    throw new Error("Reddit returned no posts");
  }

  const primary = children.filter((post) => {
    const body = normalizeWhitespace(post.selftext || "");
    return (
      post.is_self &&
      !post.stickied &&
      !post.over_18 &&
      body.length >= 300 &&
      body.length <= 3500 &&
      !isPromotional(post)
    );
  });

  if (primary.length) {
    return primary;
  }

  const relaxed = children.filter((post) => {
    const body = normalizeWhitespace(post.selftext || "");
    return post.is_self && !post.stickied && !post.over_18 && body.length >= 150;
  });

  if (!relaxed.length) {
    throw new Error("No Reddit stories passed filters");
  }

  logPhase("score_candidates", "No stories passed strict filters, using relaxed fallback filter.");
  return relaxed;
}

function selectCandidates(posts, neededCount) {
  return posts
    .map((post) => {
      const scored = scoreStory(post);
      return {
        ...post,
        video_score: scored.score,
        video_reasons: scored.reasons
      };
    })
    .sort((a, b) => b.video_score - a.video_score)
    .slice(0, neededCount);
}

function dayOfYear(date = new Date()) {
  const start = new Date(Date.UTC(date.getUTCFullYear(), 0, 0));
  const diff = date - start;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function choosePrimaryCandidate(candidates, dailyRotation) {
  if (!candidates.length) {
    return null;
  }
  if (!dailyRotation || candidates.length === 1) {
    return candidates[0];
  }
  const index = dayOfYear() % candidates.length;
  return candidates[index];
}

async function submitPiapiTask(apiKey, args, prompt, durationSeconds) {
  const payload = {
    model: "seedance",
    task_type: args.mode,
    input: {
      prompt,
      duration: durationSeconds,
      aspect_ratio: args.aspect
    }
  };

  const json = await fetchJson(
    `${PIAPI_BASE_URL}/api/v1/task`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey
      },
      body: JSON.stringify(payload),
      isPiapi: true,
      maxAttempts: 5
    },
    "submit_piapi"
  );

  const taskId = (((json || {}).data || {}).task_id || "").trim();
  if (!taskId) {
    throw new Error(`submit_piapi returned no task_id: ${truncate(JSON.stringify(json), 240)}`);
  }

  return { taskId, raw: json };
}

function normalizeTaskSuccess(taskStatus) {
  if (!taskStatus) return "unknown";
  if (taskStatus === "completed" || taskStatus === "finished") return "success";
  if (taskStatus === "failed") return "failed";
  return "pending";
}

function toErrorSummary(task) {
  const err = task && task.error ? task.error : {};
  return {
    error_code: Number(err.code || 0),
    error_message: err.message || "",
    logs: Array.isArray(task.logs) ? task.logs : []
  };
}

function taskTimedOut(task) {
  const err = task && task.error ? task.error : {};
  const logText = Array.isArray(task.logs) ? task.logs.join(" ").toLowerCase() : "";
  return Number(err.code) === 10000 || /timeout/.test(String(err.message || "").toLowerCase()) || /timeout/.test(logText);
}

async function pollPiapiTask(apiKey, taskId, args) {
  const started = Date.now();
  const deadline = started + args.maxPollMinutes * 60 * 1000;
  let lastTask = null;

  while (Date.now() < deadline) {
    const json = await fetchJson(
      `${PIAPI_BASE_URL}/api/v1/task/${encodeURIComponent(taskId)}`,
      {
        headers: {
          "x-api-key": apiKey
        },
        isPiapi: true,
        maxAttempts: 5
      },
      "poll_piapi"
    );

    const task = json && json.data ? json.data : {};
    lastTask = task;
    const mapped = normalizeTaskSuccess(task.status);

    if (mapped === "success") {
      return {
        done: true,
        success: true,
        task
      };
    }
    if (mapped === "failed") {
      return {
        done: true,
        success: false,
        task
      };
    }

    logPhase("poll_piapi", `task=${taskId} status=${task.status || "unknown"} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
    await sleep(args.pollSeconds * 1000);
  }

  return {
    done: true,
    success: false,
    timed_out: true,
    task: lastTask
  };
}

async function generateSceneClip(apiKey, args, story, scene) {
  const attempts = [];
  const prompts = [scene.prompt, scene.retry_prompt];

  for (let idx = 0; idx < prompts.length; idx += 1) {
    const prompt = prompts[idx];
    const attemptNumber = idx + 1;
    logPhase(
      "submit_piapi",
      `story=${story.id} scene=${scene.scene_index}/${scene.total_scenes} attempt=${attemptNumber} mode=${args.mode}`
    );

    const submit = await submitPiapiTask(apiKey, args, prompt, scene.seconds);
    logPhase("submit_piapi", `task_id=${submit.taskId} submitted`);

    const polled = await pollPiapiTask(apiKey, submit.taskId, args);
    const task = polled.task || {};
    const errSummary = toErrorSummary(task);
    const attemptResult = {
      scene_index: scene.scene_index,
      attempt: attemptNumber,
      task_id: submit.taskId,
      status: task.status || (polled.timed_out ? "timed_out" : "unknown"),
      prompt,
      seconds: scene.seconds,
      video_url: task.output && task.output.video ? task.output.video : "",
      ...errSummary
    };
    attempts.push(attemptResult);

    if (polled.success && attemptResult.video_url) {
      return {
        success: true,
        attempts,
        final: attemptResult
      };
    }

    if (!taskTimedOut(task)) {
      break;
    }

    if (attemptNumber < prompts.length) {
      logPhase("retry", `scene ${scene.scene_index} task ${submit.taskId} timed out; retrying simplified prompt`);
    }
  }

  return {
    success: false,
    attempts,
    final: attempts[attempts.length - 1] || null
  };
}

async function tryGenerateForStory(apiKey, args, story, scriptPackage) {
  const scenes = scriptPackage.scene_plan && scriptPackage.scene_plan.length
    ? scriptPackage.scene_plan
    : [{
      scene_index: 1,
      total_scenes: 1,
      phase: "single",
      seconds: args.duration,
      start_sec: 0,
      end_sec: args.duration,
      scene_line: scriptPackage.hook_line,
      prompt: scriptPackage.seedance_prompt,
      retry_prompt: scriptPackage.retry_prompt
    }];

  const allAttempts = [];
  const sceneResults = [];

  for (const scene of scenes) {
    const sceneGen = await generateSceneClip(apiKey, args, story, scene);
    allAttempts.push(...sceneGen.attempts);

    if (!sceneGen.success) {
      return {
        success: false,
        attempts: allAttempts,
        final: sceneGen.final,
        scenes: sceneResults,
        failed_scene: scene.scene_index
      };
    }

    sceneResults.push({
      scene_index: scene.scene_index,
      phase: scene.phase,
      seconds: scene.seconds,
      scene_line: scene.scene_line,
      task_id: sceneGen.final.task_id,
      status: sceneGen.final.status,
      video_url: sceneGen.final.video_url
    });
  }

  return {
    success: true,
    attempts: allAttempts,
    scenes: sceneResults,
    final: allAttempts[allAttempts.length - 1] || null
  };
}

function toStoryOutput(post) {
  return {
    id: post.id,
    title: post.title,
    permalink: `${REDDIT_BASE_URL}${post.permalink}`,
    score: post.video_score
  };
}

function safeSlug(input) {
  return normalizeWhitespace(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function buildCaption(payload) {
  const story = payload.selected_story || {};
  const lines = [
    `Daily Scary Story: ${story.title || "Unknown story"}`,
    "",
    payload.script_package && payload.script_package.hook_line ? payload.script_package.hook_line : "",
    "",
    `Source: ${story.permalink || ""}`,
    "#scary #horror #shortscarystories #aistory #seedance"
  ].filter(Boolean);
  return lines.join("\n");
}

async function publishLocal(payload, args) {
  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const story = payload.selected_story || {};
  const slug = safeSlug(story.title || story.id || "story");
  const outDir = path.resolve(process.cwd(), args.outputDir, `${now.toISOString().slice(0, 10)}-${slug}`);
  await fs.mkdir(outDir, { recursive: true });

  const manifestPath = path.join(outDir, "manifest.json");
  const captionPath = path.join(outDir, "caption.txt");

  const publishPayload = {
    published_at: now.toISOString(),
    run_id: stamp,
    ...payload,
    publish: {
      mode: "local",
      out_dir: outDir
    }
  };
  await fs.writeFile(manifestPath, `${JSON.stringify(publishPayload, null, 2)}\n`, "utf8");
  await fs.writeFile(captionPath, `${buildCaption(payload)}\n`, "utf8");

  return {
    mode: "local",
    out_dir: outDir,
    manifest_path: manifestPath,
    caption_path: captionPath
  };
}

async function publishWebhook(payload, args) {
  const webhookUrl = args.publishWebhookUrl || process.env.PUBLISH_WEBHOOK_URL || "";
  if (!webhookUrl) {
    throw new Error("Publish mode includes webhook, but no webhook URL was provided.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      source: "piapi-exp-daily-story",
      published_at: new Date().toISOString(),
      caption: buildCaption(payload),
      payload
    })
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Webhook publish failed with ${response.status}: ${truncate(text, 240)}`);
  }

  return {
    mode: "webhook",
    webhook_url: webhookUrl,
    response_preview: truncate(text || "ok", 200)
  };
}

async function publishResult(payload, args) {
  const publishMode = args.publishMode;
  const outputs = [];
  if (publishMode === "local" || publishMode === "both") {
    outputs.push(await publishLocal(payload, args));
  }
  if (publishMode === "webhook" || publishMode === "both") {
    outputs.push(await publishWebhook(payload, args));
  }
  return outputs;
}

async function main() {
  const startedAt = new Date();
  const args = parseArgs(process.argv.slice(2));

  logPhase(
    "start",
    `mode=${args.mode} dry_run=${args.dryRun} subreddit=${args.subreddit} time=${args.time} target=${args.targetSeconds}s scene=${args.sceneDuration}s`
  );
  const posts = await fetchRedditPosts(args);
  logPhase("fetch_reddit", `received=${posts.length} candidate stories after filtering`);

  const needed = Math.max(1, 1 + args.storyFallbacks);
  const candidates = selectCandidates(posts, needed);
  if (!candidates.length) {
    throw new Error("No story candidates available after scoring");
  }
  logPhase("score_candidates", `selected_top=${candidates.length} best_score=${candidates[0].video_score}`);

  const selectedStory = choosePrimaryCandidate(candidates, args.dailyRotation);
  const orderedCandidates = [
    selectedStory,
    ...candidates.filter((candidate) => candidate.id !== selectedStory.id)
  ];
  const scriptPackage = buildScriptPackage(selectedStory, args);

  if (args.dryRun) {
    const payload = {
      selected_story: toStoryOutput(selectedStory),
      script_package: {
        hook_line: scriptPackage.hook_line,
        beat_outline: scriptPackage.beat_outline,
        scene_plan: scriptPackage.scene_plan,
        seedance_prompt: scriptPackage.seedance_prompt,
        negative_constraints: scriptPackage.negative_constraints,
        total_target_seconds: scriptPackage.total_target_seconds
      },
      piapi: {
        task_id: "",
        status: "dry_run",
        error_code: 0,
        error_message: "",
        video_url: "",
        clip_video_urls: []
      },
      timing: {
        started_at: startedAt.toISOString(),
        completed_at: new Date().toISOString(),
        duration_sec: Math.round((Date.now() - startedAt.getTime()) / 1000)
      }
    };
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  const apiKey = args.apiKey || process.env.PIAPI_KEY || "";
  if (!apiKey) {
    throw new Error("Missing PIAPI key. Set PIAPI_KEY or pass --api-key.");
  }
  logPhase("auth", `using key ${maskKey(apiKey)}`);

  const candidateResults = [];
  for (let idx = 0; idx < orderedCandidates.length; idx += 1) {
    const story = orderedCandidates[idx];
    const packageForStory = idx === 0 ? scriptPackage : buildScriptPackage(story, args);

    logPhase("build_prompt", `story=${story.id} score=${story.video_score} title=${truncate(story.title, 80)}`);
    const generation = await tryGenerateForStory(apiKey, args, story, packageForStory);

    candidateResults.push({
      story: toStoryOutput(story),
      attempts: generation.attempts,
      scenes: generation.scenes || []
    });

    if (generation.success) {
      const clipUrls = (generation.scenes || []).map((scene) => scene.video_url).filter(Boolean);
      const payload = {
        selected_story: toStoryOutput(story),
        script_package: {
          hook_line: packageForStory.hook_line,
          beat_outline: packageForStory.beat_outline,
          scene_plan: packageForStory.scene_plan,
          seedance_prompt: packageForStory.seedance_prompt,
          negative_constraints: packageForStory.negative_constraints,
          total_target_seconds: packageForStory.total_target_seconds
        },
        piapi: {
          task_id: generation.final.task_id,
          status: generation.final.status,
          error_code: generation.final.error_code,
          error_message: generation.final.error_message,
          video_url: clipUrls.length === 1 ? clipUrls[0] : "",
          clip_video_urls: clipUrls,
          scene_outputs: generation.scenes || []
        },
        timing: {
          started_at: startedAt.toISOString(),
          completed_at: new Date().toISOString(),
          duration_sec: Math.round((Date.now() - startedAt.getTime()) / 1000)
        }
      };

      if (args.publish) {
        logPhase("publish", `mode=${args.publishMode}`);
        payload.publish = {
          requested: true,
          mode: args.publishMode,
          results: await publishResult(payload, args)
        };
      }

      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
      return;
    }

    logPhase("story_fallback", `story=${story.id} failed after ${generation.attempts.length} attempt(s)`);
  }

  const completedAt = new Date();
  const lastAttempt = candidateResults[candidateResults.length - 1];
  const lastAttemptDetails = lastAttempt && lastAttempt.attempts.length
    ? lastAttempt.attempts[lastAttempt.attempts.length - 1]
    : null;

  const failurePayload = {
    selected_story: toStoryOutput(selectedStory),
    script_package: {
      hook_line: scriptPackage.hook_line,
      beat_outline: scriptPackage.beat_outline,
      scene_plan: scriptPackage.scene_plan,
      seedance_prompt: scriptPackage.seedance_prompt,
      negative_constraints: scriptPackage.negative_constraints,
      total_target_seconds: scriptPackage.total_target_seconds
    },
    piapi: {
      task_id: lastAttemptDetails ? lastAttemptDetails.task_id : "",
      status: lastAttemptDetails ? lastAttemptDetails.status : "failed",
      error_code: lastAttemptDetails ? lastAttemptDetails.error_code : 1,
      error_message: lastAttemptDetails ? lastAttemptDetails.error_message : "Generation failed for all candidates",
      video_url: "",
      clip_video_urls: []
    },
    candidate_attempts: candidateResults,
    timing: {
      started_at: startedAt.toISOString(),
      completed_at: completedAt.toISOString(),
      duration_sec: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000)
    }
  };

  process.stdout.write(`${JSON.stringify(failurePayload, null, 2)}\n`);
  process.exitCode = 1;
}

main().catch((error) => {
  const payload = {
    error: true,
    message: error && error.message ? error.message : String(error),
    stack: process.env.DEBUG ? String(error && error.stack ? error.stack : "") : "",
    timestamp: new Date().toISOString()
  };
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(1);
});
