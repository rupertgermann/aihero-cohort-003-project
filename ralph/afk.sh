#!/bin/bash
set -eo pipefail

if [ -z "$1" ]; then
  echo "Usage: $0 <iterations>"
  exit 1
fi

# jq filter to extract streaming text from assistant messages
stream_text='select(.type == "assistant").message.content[]? | select(.type == "text").text // empty | gsub("\n"; "\r\n") | . + "\r\n\n"'

# jq filter to extract final result
final_result='select(.type == "result").result // empty'

echo "[ralph] Starting loop for $1 iteration(s)"
echo "[ralph] Working directory: $(pwd)"

for ((i=1; i<=$1; i++)); do
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "[ralph] Iteration $i / $1"

  tmpfile=$(mktemp)
  rawtmpfile=$(mktemp)
  trap "rm -f $tmpfile $rawtmpfile" EXIT

  commits=$(git log -n 5 --format="%H%n%ad%n%B---" --date=short 2>/dev/null || echo "No commits found")
  echo "[ralph] commits: $(echo "$commits" | wc -l | tr -d ' ') lines"

  issues=$(gh issue list --state open --json number,title,body,comments)
  echo "[ralph] issues JSON length: ${#issues} chars"

  prompt=$(cat ralph/prompt.md)
  echo "[ralph] prompt: $(echo "$prompt" | wc -l | tr -d ' ') lines"

  full_prompt="Previous commits: ${commits}\n\nIssues: ${issues}\n\n${prompt}"
  echo "[ralph] full_prompt total length: ${#full_prompt} chars"

  container=$(docker ps --filter "name=claude-sandbox" --format "{{.Names}}" | head -1)
  if [ -z "$container" ]; then
    echo "[error] No running claude-sandbox container found. Start it with: docker sandbox run claude ."
    exit 1
  fi
  echo "[ralph] Using container: $container"
  echo "[ralph] Launching claude via docker exec -i ..."

  set +e
  printf '%s' "$full_prompt" \
  | docker exec -i "$container" claude . -- \
    --verbose \
    --print \
    --output-format stream-json \
  > "$rawtmpfile" 2>&1
  exec_exit=$?
  set -e

  raw_lines=$(wc -l < "$rawtmpfile" | tr -d ' ')
  echo "[ralph] docker exec exit code: $exec_exit"
  echo "[ralph] raw output: $raw_lines lines"
  echo "[ralph] First 10 raw lines:"
  head -10 "$rawtmpfile" | sed 's/^/  | /'

  if [ "$raw_lines" -eq 0 ]; then
    echo "[error] No output from docker exec. Check container logs: docker logs $container"
    exit 1
  fi

  grep '^{' "$rawtmpfile" > "$tmpfile" || true
  json_lines=$(wc -l < "$tmpfile" | tr -d ' ')
  echo "[ralph] JSON lines extracted: $json_lines"

  if [ "$json_lines" -eq 0 ]; then
    echo "[error] No JSON lines found. Full raw output:"
    cat "$rawtmpfile" | sed 's/^/  | /'
    exit 1
  fi

  jq --unbuffered -rj "$stream_text" "$tmpfile" || true

  result=$(jq -r "$final_result" "$tmpfile")
  echo "[ralph] result (first 120 chars): ${result:0:120}"

  if [[ "$result" == *"<promise>NO MORE TASKS</promise>"* ]]; then
    echo "Ralph complete after $i iterations."
    exit 0
  fi
done

echo "[ralph] Loop finished after $1 iterations without completion signal."
