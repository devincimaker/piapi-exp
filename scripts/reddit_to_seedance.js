#!/usr/bin/env node
"use strict";

const PIAPI_BASE_URL = "https://api.piapi.ai";
const REDDIT_BASE_URL = "https://www.reddit.com";
const REDDIT_USER_AGENT = "piapi-exp-script/1.0";
const DEFAULTS = {
  subreddit: "shortscarystories",
  limit: 30,
  duration: 5,
  aspect: "16:9",
  time: "week",
  mode: "seedance-2-fast-preview",
  pollSeconds: 8,
  maxPollMinutes: 20,
  storyFallbacks: 1,
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
  const args = { ...DEFAULTS };
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
  --duration <n>              Seedance duration seconds (default: 5)
  --aspect <ratio>            Aspect ratio (default: 16:9)
  --mode <taskType>           PiAPI Seedance task type (default: seedance-2-fast-preview)
  --poll-seconds <n>          Poll interval seconds (default: 8)
  --max-poll-minutes <n>      Poll timeout minutes (default: 20)
  --story-fallbacks <n>       Extra stories to try after first fails (default: 1)
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

function buildScriptPackage(post) {
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

  const seedancePrompt = truncate(
    [
      `PG-13 cinematic horror short inspired by: ${title}.`,
      `Main beat: ${hookLine}.`,
      `Visual sequence: ${beatOutline.join(" ")}`,
      `Mood and camera: ${styleTokens.join(", ")}.`,
      `Constraints: ${negativeConstraints.join(", ")}.`
    ].join(" "),
    600
  );

  const retryPrompt = truncate(
    [
      `PG-13 horror scene: ${hookLine}.`,
      `A tense reveal in a realistic setting, moody lighting, slow camera move, 4k.`,
      `No gore, no text, no logo, no watermark.`
    ].join(" "),
    420
  );

  return {
    hook_line: hookLine,
    beat_outline: beatOutline,
    seedance_prompt: seedancePrompt,
    retry_prompt: retryPrompt,
    negative_constraints: negativeConstraints,
    style_tokens: styleTokens
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

async function submitPiapiTask(apiKey, args, prompt) {
  const payload = {
    model: "seedance",
    task_type: args.mode,
    input: {
      prompt,
      duration: args.duration,
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

async function tryGenerateForStory(apiKey, args, story, scriptPackage) {
  const attempts = [];
  const prompts = [
    scriptPackage.seedance_prompt,
    scriptPackage.retry_prompt
  ];

  for (let idx = 0; idx < prompts.length; idx += 1) {
    const prompt = prompts[idx];
    const attemptNumber = idx + 1;
    logPhase("submit_piapi", `story=${story.id} attempt=${attemptNumber} mode=${args.mode}`);

    const submit = await submitPiapiTask(apiKey, args, prompt);
    logPhase("submit_piapi", `task_id=${submit.taskId} submitted`);

    const polled = await pollPiapiTask(apiKey, submit.taskId, args);
    const task = polled.task || {};
    const errSummary = toErrorSummary(task);

    const result = {
      attempt: attemptNumber,
      task_id: submit.taskId,
      status: task.status || (polled.timed_out ? "timed_out" : "unknown"),
      prompt,
      video_url: task.output && task.output.video ? task.output.video : "",
      ...errSummary
    };
    attempts.push(result);

    if (polled.success && result.video_url) {
      return {
        success: true,
        attempts,
        final: result,
        raw_task: task
      };
    }

    if (!taskTimedOut(task)) {
      break;
    }

    if (attemptNumber < prompts.length) {
      logPhase("retry", `task ${submit.taskId} timed out; retrying once with simplified prompt`);
    }
  }

  return {
    success: false,
    attempts,
    final: attempts[attempts.length - 1] || null
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

async function main() {
  const startedAt = new Date();
  const args = parseArgs(process.argv.slice(2));

  logPhase("start", `mode=${args.mode} dry_run=${args.dryRun} subreddit=${args.subreddit} time=${args.time}`);
  const posts = await fetchRedditPosts(args);
  logPhase("fetch_reddit", `received=${posts.length} candidate stories after filtering`);

  const needed = Math.max(1, 1 + args.storyFallbacks);
  const candidates = selectCandidates(posts, needed);
  if (!candidates.length) {
    throw new Error("No story candidates available after scoring");
  }
  logPhase("score_candidates", `selected_top=${candidates.length} best_score=${candidates[0].video_score}`);

  const selectedStory = candidates[0];
  const scriptPackage = buildScriptPackage(selectedStory);

  if (args.dryRun) {
    const payload = {
      selected_story: toStoryOutput(selectedStory),
      script_package: {
        hook_line: scriptPackage.hook_line,
        beat_outline: scriptPackage.beat_outline,
        seedance_prompt: scriptPackage.seedance_prompt,
        negative_constraints: scriptPackage.negative_constraints
      },
      piapi: {
        task_id: "",
        status: "dry_run",
        error_code: 0,
        error_message: "",
        video_url: ""
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
  for (let idx = 0; idx < candidates.length; idx += 1) {
    const story = candidates[idx];
    const packageForStory = idx === 0 ? scriptPackage : buildScriptPackage(story);

    logPhase("build_prompt", `story=${story.id} score=${story.video_score} title=${truncate(story.title, 80)}`);
    const generation = await tryGenerateForStory(apiKey, args, story, packageForStory);

    candidateResults.push({
      story: toStoryOutput(story),
      attempts: generation.attempts
    });

    if (generation.success) {
      const payload = {
        selected_story: toStoryOutput(story),
        script_package: {
          hook_line: packageForStory.hook_line,
          beat_outline: packageForStory.beat_outline,
          seedance_prompt: packageForStory.seedance_prompt,
          negative_constraints: packageForStory.negative_constraints
        },
        piapi: {
          task_id: generation.final.task_id,
          status: generation.final.status,
          error_code: generation.final.error_code,
          error_message: generation.final.error_message,
          video_url: generation.final.video_url
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
      seedance_prompt: scriptPackage.seedance_prompt,
      negative_constraints: scriptPackage.negative_constraints
    },
    piapi: {
      task_id: lastAttemptDetails ? lastAttemptDetails.task_id : "",
      status: lastAttemptDetails ? lastAttemptDetails.status : "failed",
      error_code: lastAttemptDetails ? lastAttemptDetails.error_code : 1,
      error_message: lastAttemptDetails ? lastAttemptDetails.error_message : "Generation failed for all candidates",
      video_url: ""
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
