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
#   --platforms LIST       default: the native platform of this machine
#   --image NAME           default ghcr.io/ulanproger/twenty
#   --tag TAG              default sha-<first 10 chars of HEAD>-<arch> for one platform, sha-<...> for several
#   --allow-emulation      build a foreign platform anyway (see above, expect it to fail)
#   --install-emulation    with --allow-emulation: install QEMU handlers (runs a privileged container)
#   --cleanup              prune the builder cache when done
#   --allow-dirty          build even if the working tree has uncommitted changes
#   --dry-run              run the checks and print the build command, build nothing
# Environment: GHCR_USER (default ulanproger) and GHCR_TOKEN (needs write:packages) for --push;
#   without GHCR_TOKEN an existing `docker login ghcr.io` is used. MIN_MEMORY_GB, MIN_DISK_GB.
set -euo pipefail

IMAGE="ghcr.io/ulanproger/twenty"
TAG=""
PLATFORMS=""
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
    --allow-emulation) allow_emulation=1 ;;
    --install-emulation) install_emulation=1 ;;
    --cleanup) cleanup=1 ;;
    --allow-dirty) allow_dirty=1 ;;
    --dry-run) dry_run=1 ;;
    -h | --help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
  esac
  shift
done

fail() { echo "ERROR: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)" || fail "run this from inside a git checkout"
[ -f "$DOCKERFILE" ] || fail "$DOCKERFILE not found: run it from the twenty repository"

command -v docker >/dev/null || fail "docker is not installed"
docker info >/dev/null 2>&1 || fail "the docker daemon is not reachable (is it running, are you in the docker group?)"
docker buildx version >/dev/null 2>&1 || fail "docker buildx is missing (install docker-buildx-plugin)"

if [ "$allow_dirty" = "0" ] && [ -n "$(git status --porcelain -uno)" ]; then
  fail "the working tree has uncommitted changes; commit or stash them, or pass --allow-dirty"
fi

native_arch="$(docker info --format '{{.Architecture}}')"
case "$native_arch" in
  x86_64) native_platform="linux/amd64" ;;
  aarch64 | arm64) native_platform="linux/arm64" ;;
  *) native_platform="unknown" ;;
esac

if [ -z "$PLATFORMS" ]; then
  [ "$native_platform" != "unknown" ] || fail "unknown machine architecture '$native_arch'; pass --platforms"
  PLATFORMS="$native_platform"
fi

SHA10="$(git rev-parse --short=10 HEAD)"
if [ -z "$TAG" ]; then
  case "$PLATFORMS" in
    *,*) TAG="sha-$SHA10" ;;
    *) TAG="sha-$SHA10-${PLATFORMS##*/}" ;;
  esac
fi
VERSION="$(sed -n "s/.*TWENTY_CURRENT_VERSION = '\([^']*\)'.*/\1/p" "$VERSION_FILE")"
[ -n "$VERSION" ] || fail "could not read TWENTY_CURRENT_VERSION from $VERSION_FILE"

# The reason this script exists: without this call a database that already finished its version never gets the OIDC table.
grep -Fq "command:prod run-instance-commands" packages/twenty-docker/twenty/entrypoint.sh \
  || fail "entrypoint.sh has no 'run-instance-commands' step (seam S8); refusing to build an image without it"

echo "commit:     $SHA10 ($(git rev-parse --abbrev-ref HEAD))"
echo "version:    $VERSION"
echo "image:      $IMAGE:$TAG"
echo "platforms:  $PLATFORMS"

memory_gb=$(( $(docker info --format '{{.MemTotal}}') / 1024 / 1024 / 1024 ))
disk_gb=$(( $(docker run --rm alpine df -Pk / | awk 'NR==2 {print $4}') / 1024 / 1024 ))
echo "docker RAM: ${memory_gb} GB (need ${MIN_MEMORY_GB}), free disk for images: ${disk_gb} GB (need ${MIN_DISK_GB})"
[ "$memory_gb" -ge "$MIN_MEMORY_GB" ] || fail "not enough memory for the front build; add RAM or swap, or lower MIN_MEMORY_GB at your own risk"
[ "$disk_gb" -ge "$MIN_DISK_GB" ] || fail "not enough free disk where docker stores images (an out-of-space error would stop the build midway)"

IFS=',' read -r -a platform_list <<< "$PLATFORMS"
for platform in "${platform_list[@]}"; do
  [ "$platform" = "$native_platform" ] && continue
  [ "$allow_emulation" = "1" ] || fail "$platform is not the native platform ($native_platform) of this machine, and building it under emulation fails for this image (lingui extract times out). Build it on a $platform machine and join the tags with docker buildx imagetools create, or pass --allow-emulation to try anyway"
  if ! docker run --rm --platform "$platform" alpine uname -m >/dev/null 2>&1; then
    if [ "$install_emulation" = "1" ]; then
      echo "installing QEMU handlers for $platform (privileged container)"
      docker run --privileged --rm tonistiivi/binfmt --install all >/dev/null
      docker run --rm --platform "$platform" alpine uname -m >/dev/null 2>&1 || fail "emulation for $platform still does not work"
    else
      fail "cannot run $platform containers here. Install emulation once with: docker run --privileged --rm tonistiivi/binfmt --install all (or pass --install-emulation)"
    fi
  fi
  echo "warning: $platform is built under emulation: very slow, and lingui extract is expected to time out"
done

if [ "$push" = "1" ]; then
  output=(--push --tag "$IMAGE:$TAG")
else
  archive="$PWD/twenty-$TAG.oci.tar"
  output=(--output "type=oci,dest=$archive,name=$IMAGE:$TAG")
fi

build_command=(docker buildx build --builder "$BUILDER" --progress=plain --platform "$PLATFORMS"
  --target twenty -f "$DOCKERFILE" --build-arg "APP_VERSION=$VERSION" "${output[@]}" .)

if [ "$dry_run" = "1" ]; then
  echo "dry run, would use the builder '$BUILDER' (created with one build step at a time to limit memory) and run:"
  echo "  ${build_command[*]}"
  exit 0
fi

logged_in=0
cleanup_login() { [ "$logged_in" = "1" ] && docker logout ghcr.io >/dev/null 2>&1 || true; }
trap cleanup_login EXIT

if [ "$push" = "1" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-ulanproger}" --password-stdin >/dev/null
  logged_in=1
fi

if ! docker buildx inspect "$BUILDER" >/dev/null 2>&1; then
  config="$(mktemp)"
  printf '[worker.oci]\n  max-parallelism = 1\n' > "$config"
  docker buildx create --name "$BUILDER" --driver docker-container --buildkitd-config "$config" >/dev/null
  rm -f "$config"
fi

log="$PWD/build-$TAG.log"
echo "building, the full log goes to $log"
"${build_command[@]}" 2>&1 | tee "$log"

if [ "$push" = "1" ]; then
  echo "published, platforms in the manifest:"
  docker buildx imagetools inspect "$IMAGE:$TAG" | grep -E "Name:|Platform:" | grep -v "unknown/unknown"
else
  echo "archive written: $archive ($(du -h "$archive" | cut -f1)); nothing was published. Re-run with --push to publish (the builder cache makes it fast)."
fi

if [ "$cleanup" = "1" ]; then
  docker buildx prune --builder "$BUILDER" -af >/dev/null
  echo "builder cache pruned"
fi
