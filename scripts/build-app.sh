#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd -- "$repo_root"

install_dependencies=false
if [[ $# -gt 0 ]]; then
  if [[ $# -ne 1 || $1 != --install ]]; then
    printf 'Usage: bash scripts/build-app.sh [--install]\n' >&2
    exit 2
  fi
  install_dependencies=true
fi

if [[ $install_dependencies == true ]]; then
  npm --prefix frontend ci
elif [[ ! -d frontend/node_modules ]]; then
  printf 'Frontend dependencies are missing. Run npm --prefix frontend ci, or use --install to install the existing lockfile.\n' >&2
  exit 1
fi

# Clean before copying the frontend; a later clean would erase the static files.
./backend/mvnw -f backend/pom.xml --batch-mode clean
npm --prefix frontend run build
mkdir -p backend/target/classes/static
cp -R frontend/dist/. backend/target/classes/static/
mkdir -p backend/target/classes/staging-audio
cp -R frontend/spikes/audio/*.html frontend/spikes/audio/*.js frontend/spikes/audio/*.css backend/target/classes/staging-audio/
./backend/mvnw -f backend/pom.xml --batch-mode -DskipTests package

printf '\nBuilt %s/backend/target/memory-archive-0.0.1-SNAPSHOT.jar\n' "$repo_root"
printf 'Backend tests are a separate check; this packaging command skips them.\n'
