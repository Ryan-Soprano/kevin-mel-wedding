#!/usr/bin/env bash
set -euo pipefail

image_archive="${1:?Usage: prepare-ci-images.sh IMAGE_ARCHIVE}"
ryuk_image="${TESTCONTAINERS_RYUK_CONTAINER_IMAGE:?Ryuk image must match the CI workflow}"

if [[ -f "$image_archive" ]]; then
  docker image load --input "$image_archive"
fi

pull_image() {
  local target="$1"
  shift
  if docker image inspect "$target" >/dev/null 2>&1; then
    return 0
  fi

  local attempt source
  for attempt in 1 2 3; do
    for source in "$@"; do
      echo "Pulling $source for $target (attempt $attempt/3)"
      if timeout 45s docker pull "$source"; then
        if [[ "$source" != "$target" ]]; then
          docker tag "$source" "$target"
        fi
        return 0
      fi
    done
    if [[ "$attempt" -lt 3 ]]; then
      sleep "$((attempt * 5 + RANDOM % 5))"
    fi
  done
  echo "Unable to prepare required test image: $target" >&2
  return 1
}

# Recheck Alpine/Ryuk helper versions when upgrading Testcontainers.
# Both registries distribute the official images; Docker Hub is a bounded fallback.
pull_image postgres:17 public.ecr.aws/docker/library/postgres:17 postgres:17
pull_image alpine:3.17 public.ecr.aws/docker/library/alpine:3.17 alpine:3.17
pull_image "$ryuk_image" "$ryuk_image" testcontainers/ryuk:0.14.0
docker image inspect postgres:17 alpine:3.17 "$ryuk_image" --format '{{.RepoTags}} {{.Id}}'

if [[ ! -f "$image_archive" ]]; then
  docker image save --output "$image_archive" postgres:17 alpine:3.17 "$ryuk_image"
fi
