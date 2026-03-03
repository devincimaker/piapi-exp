# Reddit to Seedance (PiAPI)

This project runs an experiment pipeline:
1. Fetch top stories from `r/shortscarystories`
2. Select a video-friendly story
3. Build a scene plan and Seedance-ready PG-13 prompts
4. Submit one or many scene clips to PiAPI (`seedance-2-fast-preview`)
5. Poll until completion and print final JSON output
6. Optionally publish local artifacts and/or webhook payload

## Setup

```bash
cp .env.example .env
export PIAPI_KEY=your_rotated_key_here
```

## Run

Dry run (no PiAPI call):

```bash
npm run dry-run
```

Full run:

```bash
npm start
```

Daily run (targeting a longer multi-scene video):

```bash
npm run daily
```

## Useful options

```bash
node scripts/reddit_to_seedance.js \
  --limit 30 \
  --time week \
  --target-seconds 20 \
  --scene-duration 5 \
  --max-scenes 4 \
  --aspect 16:9 \
  --mode seedance-2-fast-preview \
  --story-fallbacks 1 \
  --daily-rotation \
  --publish \
  --publish-mode local
```

## Output shape

The script prints a JSON object with:
- `selected_story`
- `script_package`
- `piapi` (`task_id`, `status`, `video_url`, `clip_video_urls`, scene outputs, errors)
- `timing`

On complete failure it also includes `candidate_attempts`.

## Story -> scenes mapping

The converter now creates an explicit `scene_plan`:
- Splits story into sentences
- Scores sentence visual strength (setting/action/tension/twist signals)
- Picks scene anchors across the full arc
- Assigns per-scene durations
- Builds one prompt per scene (+ simplified retry prompt)

If `target-seconds` > `scene-duration`, the script generates multiple scene clips.

## Publishing

`--publish-mode local`:
- Writes `manifest.json` + `caption.txt` under `outputs/<date>-<slug>/`

`--publish-mode webhook`:
- Sends JSON payload to `PUBLISH_WEBHOOK_URL`

`--publish-mode both`:
- Does both local and webhook publishing

## Daily automation (GitHub Actions)

Workflow file:
- `.github/workflows/daily-scary-story.yml`

Set in GitHub repo settings:
- Secret: `PIAPI_KEY` (required)
- Secret: `PUBLISH_WEBHOOK_URL` (required only if webhook mode is used)
- Variables (optional): `PUBLISH_MODE`, `TARGET_SECONDS`, `SCENE_DURATION`, `MAX_SCENES`, `REDDIT_LIMIT`, `REDDIT_TIME`

## Notes

- PiAPI success may appear as `finished` in history and `completed` in task detail.
- Timeout errors (`error.code = 10000`) trigger one simplified-prompt retry.
- API key is never hardcoded; use `PIAPI_KEY` or `--api-key`.
