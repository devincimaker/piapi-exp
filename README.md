# Reddit to Seedance (PiAPI)

This project runs an experiment pipeline:
1. Fetch top stories from `r/shortscarystories`
2. Select a video-friendly story
3. Build a Seedance-ready PG-13 prompt package
4. Submit to PiAPI (`seedance-2-fast-preview`)
5. Poll until completion and print final JSON output

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

## Useful options

```bash
node scripts/reddit_to_seedance.js \
  --limit 30 \
  --time week \
  --duration 5 \
  --aspect 16:9 \
  --mode seedance-2-fast-preview \
  --story-fallbacks 1
```

## Output shape

The script prints a JSON object with:
- `selected_story`
- `script_package`
- `piapi` (`task_id`, `status`, `video_url`, errors)
- `timing`

On complete failure it also includes `candidate_attempts`.

## Notes

- PiAPI success may appear as `finished` in history and `completed` in task detail.
- Timeout errors (`error.code = 10000`) trigger one simplified-prompt retry.
- API key is never hardcoded; use `PIAPI_KEY` or `--api-key`.
