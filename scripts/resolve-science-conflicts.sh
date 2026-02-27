#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCI_DIR="app/models/precomputed/scientific-method"

cd "$ROOT_DIR"

CONFLICTS=$(git diff --name-only --diff-filter=U || true)
SCI_CONFLICTS=$(printf "%s\n" "$CONFLICTS" | awk 'NF' | grep "^${SCI_DIR}/" || true)

if [[ -z "$SCI_CONFLICTS" ]]; then
  echo "No unresolved conflicts found under ${SCI_DIR}."
  exit 0
fi

echo "Resolving scientific-method conflicts by regenerating derived artifacts..."
printf '%s\n' "$SCI_CONFLICTS"

# Keep local versions of extraction/validation source files if they are conflicted.
for src in \
  gen/extract-scientific-dataset.js \
  gen/science/validate-science-data.js \
  docs/scientific-method-data.md \
  package.json
  do
  if printf "%s\n" "$CONFLICTS" | grep -qx "$src"; then
    git checkout --ours -- "$src"
    git add "$src"
    echo "Kept --ours for $src"
  fi
done

# Regenerate all derived files from source-of-truth extractor.
npm run extract-science-data
npm run validate-science-data

# Stage regenerated scientific datasets.
git add "$SCI_DIR"

echo "Scientific conflict resolution complete. Staged regenerated artifacts from ${SCI_DIR}."
