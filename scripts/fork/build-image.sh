#!/bin/bash
# Builds the fork image the way the "Fork build GHCR image" workflow does, for when GitHub
# Actions is not available. Run it from the root of a clean checkout of the commit to build.
# By default it builds only the native platform of this machine. Building a foreign platform
# under emulation fails for this image (lingui extract hits the 10 s worker init timeout of the
# threads library), so build each platform on a machine of its own architecture and join the tags:
#   docker buildx imagetools create -t IMAGE:sha-X IMAGE:sha-X-amd64 IMAGE:sha-X-arm64
#
# Usage: build-image.sh [options]
#   --push                 publish the image (default: write an OCI archive only)
#   --platforms LIST       default: the native platform of this machine, e.g. linux/amd64
#   --image NAME           default ghcr.io/ulanproger/twenty (no tag)
#   --tag TAG              default sha-<first 10 chars of HEAD>-<arch> for one platform, sha-<...> for several
#   --output-dir DIR       where the archive and the log go, outside the checkout (default ~/twenty-image-output)
#   --allow-emulation      build a foreign platform anyway (see above, expect it to fail)
#   --install-emulation    with --allow-emulation: install QEMU handlers (runs a privileged container)
#   --cleanup              prune the builder cache when done
#   --allow-dirty          build even if the checkout has uncommitted or untracked files
#   --dry-run              run the checks and print the build command, build nothing
# Environment: GHCR_USER (default ulanproger) and GHCR_TOKEN (needs write:packages) for --push;
#   without GHCR_TOKEN an existing `docker login ghcr.io` is used. MIN_MEMORY_GB, MIN_DISK_GB.
set -euo pipefail

IMAGE="ghcr.io/ulanproger/twenty"
TAG=""
PLATFORMS=""
OUTPUT_DIR="${TWENTY_IMAGE_OUTPUT_DIR:-$HOME/twenty-image-output}"
BUILDER="twenty-multiarch"
DOCKERFILE="packages/twenty-docker/twenty/Dockerfile"
VERSION_FILE="packages/twenty-server/src/engine/core-modules/upgrade/constants/twenty-current-version.constant.ts"
MIN_MEMORY_GB="${MIN_MEMORY_GB:-8}"
MIN_DISK_GB="${MIN_DISK_GB:-40}"
push=0
allow_emulation=0
install_emulation=0
cleanup=0
allow_dirty=0
dry_run=0

while [ $# -gt 0 ]; do
  case "$1" in
    --push) push=1 ;;
    --platforms) PLATFORMS="${2:?--platforms needs a value}"; shift ;;
    --image) IMAGE="${2:?--image needs a value}"; shift ;;
    --tag) TAG="${2:?--tag needs a value}"; shift ;;
    --output-dir) OUTPUT_DIR="${2:?--output-dir needs a value}"; shift ;;
    --allow-emulation) allow_emulation=1 ;;
    --install-emulation) install_emulation=1 ;;
    --cleanup) cleanup=1 ;;
    --allow-dirty) allow_dirty=1 ;;
    --dry-run) dry_run=1 ;;
    -h | --help) awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "$0"; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

fail() { echo "ERROR: $*" >&2; exit 1; }
warn() { echo "warning: $*" >&2; }

cd "$(git rev-parse --show-toplevel)" || fail "run this from inside a git checkout"
[ -f "$DOCKERFILE" ] || fail "$DOCKERFILE not found: run it from the twenty repository"

command -v docker >/dev/null || fail "docker is not installed"
if ! docker_info_output="$(docker info 2>&1)"; then
  hint=""
  case "$docker_info_output" in
    *"permission denied"*) hint=" (add yourself to the docker group and log in again, or run with sudo)" ;;
  esac
  reason="$(printf '%s\n' "$docker_info_output" | grep -m 1 -i -E 'cannot connect|permission denied|error' || true)"
  fail "the docker daemon is not reachable$hint: ${reason:-no details from docker info}"
fi
docker buildx version >/dev/null 2>&1 || fail "docker buildx is missing (install docker-buildx-plugin)"

docker_endpoint="${DOCKER_HOST:-$(docker context inspect --format '{{.Endpoints.docker.Host}}' 2>/dev/null || true)}"
case "$docker_endpoint" in
  ssh://* | tcp://*) warn "the docker daemon is remote ($docker_endpoint): the memory, disk and architecture checks describe that machine, not this one" ;;
esac

if [ "$allow_dirty" = "0" ] && [ -n "$(git status --porcelain)" ]; then
  fail "the checkout has uncommitted or untracked files; commit, stash or remove them, or pass --allow-dirty (the build context would not match the commit)"
fi

case "$OUTPUT_DIR" in
  "$PWD" | "$PWD"/*) fail "--output-dir must be outside the checkout, otherwise the archive and the log become part of the working tree" ;;
esac

native_arch="$(docker info --format '{{.Architecture}}' 2>/dev/null || true)"
case "$native_arch" in
  x86_64) native_platform="linux/amd64" ;;
  aarch64 | arm64) native_platform="linux/arm64" ;;
  "") native_platform="" ;;
  *) native_platform="linux/$(printf '%s' "$native_arch" | tr '[:upper:]' '[:lower:]')" ;;
esac

PLATFORMS="$(printf '%s' "${PLATFORMS:-$native_platform}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"
[ -n "$PLATFORMS" ] || fail "could not detect the machine architecture; pass --platforms"
IFS=',' read -r -a platform_list <<< "$PLATFORMS"
for platform in "${platform_list[@]}"; do
  [[ "$platform" =~ ^linux/[a-z0-9]+(/v[0-9]+)?$ ]] || fail "invalid platform '$platform', expected something like linux/amd64"
done

case "${IMAGE##*/}" in
  *:*) fail "--image must not contain a tag ('$IMAGE'), use --tag" ;;
esac

SHA10="$(git rev-parse --short=10 HEAD)"
if [ -z "$TAG" ]; then
  case "$PLATFORMS" in
    *,*) TAG="sha-$SHA10" ;;
    *) suffix="${PLATFORMS#linux/}"; TAG="sha-$SHA10-${suffix//\//-}" ;;
  esac
fi
[[ "$TAG" =~ ^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$ ]] || fail "invalid tag '$TAG'"

VERSION="$(sed -n "s/.*TWENTY_CURRENT_VERSION = '\([^']*\)'.*/\1/p" "$VERSION_FILE")"
[ -n "$VERSION" ] || fail "could not read TWENTY_CURRENT_VERSION from $VERSION_FILE"

# The reason this script exists: without this call a database that already finished its version never gets the OIDC table.
grep -Fq "command:prod run-instance-commands" packages/twenty-docker/twenty/entrypoint.sh \
  || fail "entrypoint.sh has no 'run-instance-commands' step (seam S8); refusing to build an image without it"

docker_config_file="${DOCKER_CONFIG:-$HOME/.docker}/config.json"
had_ghcr_login=0
grep -q '"ghcr.io"' "$docker_config_file" 2>/dev/null && had_ghcr_login=1
if [ "$push" = "1" ] && [ -z "${GHCR_TOKEN:-}" ] && [ "$had_ghcr_login" = "0" ]; then
  fail "--push needs credentials: set GHCR_TOKEN (write:packages) or run 'docker login ghcr.io' first, otherwise the build would fail only at the very end"
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
[ "$branch" = "HEAD" ] && branch="detached"
echo "commit:     $SHA10 ($branch)"
echo "version:    $VERSION"
echo "image:      $IMAGE:$TAG"
echo "platforms:  $PLATFORMS"

free_disk_gb() {
  local root kb=""
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -n "$root" ] && [ -d "$root" ]; then
    kb="$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print $4}')"
  fi
  if ! [[ "$kb" =~ ^[0-9]+$ ]]; then
    kb="$(docker run --rm alpine df -Pk / 2>/dev/null | awk 'NR==2 {print $4}')"
  fi
  [[ "$kb" =~ ^[0-9]+$ ]] && echo $((kb / 1024 / 1024))
  return 0
}

memory_bytes="$(docker info --format '{{.MemTotal}}' 2>/dev/null || true)"
if [[ "$memory_bytes" =~ ^[0-9]+$ ]] && [ "$memory_bytes" -gt 0 ]; then
  memory_gb=$((memory_bytes / 1024 / 1024 / 1024))
  echo "docker RAM: ${memory_gb} GB (need ${MIN_MEMORY_GB})"
  [ "$memory_gb" -ge "$MIN_MEMORY_GB" ] || fail "not enough memory for the front build; add RAM or swap, or lower MIN_MEMORY_GB at your own risk"
else
  warn "could not read the memory of the docker daemon, the memory check is skipped"
fi

disk_gb="$(free_disk_gb)"
if [ -n "$disk_gb" ]; then
  echo "free disk where docker stores images: ${disk_gb} GB (need ${MIN_DISK_GB})"
  [ "$disk_gb" -ge "$MIN_DISK_GB" ] || fail "not enough free disk where docker stores images (an out-of-space error would stop the build midway)"
else
  warn "could not measure the free disk of the docker daemon (offline and alpine not pulled?), the disk check is skipped"
fi

if [ "$push" = "0" ]; then
  out_kb="$(df -Pk "$(dirname "$OUTPUT_DIR")" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ "$out_kb" =~ ^[0-9]+$ ]] && [ $((out_kb / 1024 / 1024)) -lt 10 ]; then
    warn "less than 10 GB free next to $OUTPUT_DIR, the OCI archive can take a few GB"
  fi
fi

for platform in "${platform_list[@]}"; do
  [ "$platform" = "$native_platform" ] && continue
  [ "$allow_emulation" = "1" ] || fail "$platform is not the native platform (${native_platform:-unknown}) of this machine, and building it under emulation fails for this image (lingui extract times out). Build it on a $platform machine and join the tags with docker buildx imagetools create, or pass --allow-emulation to try anyway"
  if ! docker run --rm --platform "$platform" alpine uname -m >/dev/null 2>&1; then
    if [ "$install_emulation" = "1" ]; then
      echo "installing QEMU handlers for $platform (privileged container)"
      docker run --privileged --rm tonistiivi/binfmt --install all >/dev/null
      docker run --rm --platform "$platform" alpine uname -m >/dev/null 2>&1 || fail "emulation for $platform still does not work"
    else
      fail "cannot run $platform containers here. Install emulation once with: docker run --privileged --rm tonistiivi/binfmt --install all (or pass --install-emulation)"
    fi
  fi
  warn "$platform is built under emulation: very slow, and lingui extract is expected to time out"
done

archive="$OUTPUT_DIR/twenty-$TAG.oci.tar"
log="$OUTPUT_DIR/build-$TAG.log"
if [ "$push" = "1" ]; then
  output=(--push --tag "$IMAGE:$TAG")
else
  output=(--output "type=oci,dest=$archive,name=$IMAGE:$TAG")
fi

build_command=(docker buildx build --builder "$BUILDER" --progress=plain --platform "$PLATFORMS"
  --target twenty -f "$DOCKERFILE" --build-arg "APP_VERSION=$VERSION" "${output[@]}" .)

if [ "$dry_run" = "1" ]; then
  echo "dry run, would use the builder '$BUILDER' (reused if it exists, otherwise created with one build step at a time to limit memory) and run:"
  echo "  ${build_command[*]}"
  echo "  log: $log"
  exit 0
fi

logged_in=0
cleanup_login() { [ "$logged_in" = "1" ] && docker logout ghcr.io >/dev/null 2>&1 || true; }
trap cleanup_login EXIT

if [ "$push" = "1" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-ulanproger}" --password-stdin >/dev/null \
    || fail "docker login failed; on a headless server without a credential helper remove \"credsStore\" from $docker_config_file or point DOCKER_CONFIG at another directory"
  # A login that existed before is overwritten with the token and must stay in place afterwards.
  [ "$had_ghcr_login" = "0" ] && logged_in=1
fi

if docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  builder_state="reusing the existing builder"
else
  config="$(mktemp)"
  printf '[worker.oci]\n  max-parallelism = 1\n' > "$config"
  docker buildx create --name "$BUILDER" --driver docker-container --buildkitd-config "$config" >/dev/null
  rm -f "$config"
  builder_state="created with one build step at a time"
fi
docker buildx inspect --bootstrap "$BUILDER" >/dev/null 2>&1 \
  || fail "the builder '$BUILDER' cannot start (it needs network access to pull moby/buildkit); remove it with 'docker buildx rm $BUILDER' and retry"
echo "builder:    $BUILDER ($builder_state)"

mkdir -p "$OUTPUT_DIR"
echo "building, the full log goes to $log"
if ! "${build_command[@]}" 2>&1 | tee "$log"; then
  fail "the build failed, see $log"
fi

if [ "$push" = "1" ]; then
  echo "published, platforms in the manifest:"
  { docker buildx imagetools inspect "$IMAGE:$TAG" 2>&1 | grep -E "Name:|Platform:" | grep -v "unknown/unknown"; } || true
else
  echo "archive written: $archive ($(du -h "$archive" | cut -f1)); nothing was published. Re-run with --push to publish (fast while the builder cache is kept, i.e. without --cleanup)."
fi

if [ "$cleanup" = "1" ]; then
  docker buildx prune --builder "$BUILDER" -af >/dev/null
  echo "builder cache pruned"
fi
