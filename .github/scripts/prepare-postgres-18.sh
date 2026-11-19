#!/usr/bin/env bash
set -euo pipefail

# Official PGDG Ubuntu packages; fixture binaries only. No sudo, apt install,
# maintainer script, system service or existing database is touched.
# https://www.postgresql.org/download/linux/ubuntu/
# https://wiki.postgresql.org/wiki/Apt/FAQ#Where_are_older_versions_of_the_packages.3F
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]]
. /etc/os-release
[[ "$ID" == ubuntu && "$VERSION_ID" == 24.04 ]]
: "${RUNNER_TEMP:?GitHub runner temporary directory required}"
: "${GITHUB_ENV:?GitHub step environment required}"
[[ "$RUNNER_TEMP" == /* && "$RUNNER_TEMP" != *$'\n'* && "$RUNNER_TEMP" != *$'\r'* ]]
pg_home="$(mktemp -d "$RUNNER_TEMP/rmt-pg18.6.XXXXXX")"
chmod 700 "$pg_home"
printf 'RMT_PG18_EVIDENCE=%s\n' "$pg_home" >> "$GITHUB_ENV"
bins=(postgres initdb pg_ctl pg_dump pg_restore psql createdb dropdb pg_isready)
exact_version() {
  local candidate="$1" item
  for item in "${bins[@]}"; do
    [[ -x "$candidate/$item" ]] || return 1
    "$candidate/$item" --version | grep -Eq 'PostgreSQL\) 18\.6([[:space:](]|$)' || return 1
  done
}
pg_bin=/usr/lib/postgresql/18/bin
mode=PREINSTALLED_EXACT_18_6
if ! exact_version "$pg_bin"; then
  for tool in curl gpg gpgv node dpkg-deb sha256sum ldd; do command -v "$tool" >/dev/null; done
  mkdir -m 700 "$pg_home/gnupg" "$pg_home/root"
  download() { curl --fail --silent --show-error --retry 2 --max-time 60 --proto '=https' --tlsv1.2 --max-filesize "$3" "$1" --output "$2"; }
  download https://www.postgresql.org/media/keys/ACCC4CF8.asc "$pg_home/pgdg.asc" 65536
  fingerprint="$(gpg --batch --homedir "$pg_home/gnupg" --show-keys --with-colons "$pg_home/pgdg.asc" | awk -F: '$1=="fpr" {print $10; exit}')"
  [[ "$fingerprint" == B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8 ]]
  gpg --batch --homedir "$pg_home/gnupg" --dearmor --output "$pg_home/pgdg.gpg" "$pg_home/pgdg.asc"
  repository=https://apt.postgresql.org/pub/repos/apt
  download "$repository/dists/noble-pgdg/InRelease" "$pg_home/InRelease" 4194304
  gpgv --homedir "$pg_home/gnupg" --keyring "$pg_home/pgdg.gpg" --output "$pg_home/Release" "$pg_home/InRelease"
  download "$repository/dists/noble-pgdg/main/binary-amd64/Packages.gz" "$pg_home/Packages.gz" 16777216
  node .github/scripts/postgres-18-packages.mjs "$pg_home/Release" "$pg_home/Packages.gz" "$pg_home/provenance.json" > "$pg_home/packages.tsv"
  while IFS=$'\t' read -r name filename size checksum; do
    archive="$pg_home/${filename##*/}"
    download "$repository/$filename" "$archive" "$size"
    [[ "$(stat -c %s "$archive")" == "$size" ]]
    printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --strict
    [[ "$(dpkg-deb --field "$archive" Package)" == "$name" ]]
    [[ "$(dpkg-deb --field "$archive" Version)" == 18.6-1.pgdg24.04+2 ]]
    [[ "$(dpkg-deb --field "$archive" Architecture)" == amd64 ]]
    dpkg-deb --extract "$archive" "$pg_home/root"
  done < "$pg_home/packages.tsv"
  pg_bin="$pg_home/root/usr/lib/postgresql/18/bin"
  export LD_LIBRARY_PATH="$pg_home/root/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
  ldd "$pg_bin/postgres" > "$pg_home/postgres-before-runtime.ldd"
  if grep -q 'liburing.so.2 => not found' "$pg_home/postgres-before-runtime.ldd"; then
    # PG18 requires liburing2, absent from the current hosted runner. Use only
    # the exact Ubuntu Noble runtime in this same temporary root, not apt install.
    # Ubuntu archive key: https://wiki.ubuntu.com/SecurityTeam/FAQ
    ubuntu=https://archive.ubuntu.com/ubuntu
    download "$ubuntu/dists/noble/InRelease" "$pg_home/ubuntu-InRelease" 4194304
    gpgv --homedir "$pg_home/gnupg" --keyring /usr/share/keyrings/ubuntu-archive-keyring.gpg \
      --status-fd 3 --output "$pg_home/ubuntu-Release" "$pg_home/ubuntu-InRelease" 3> "$pg_home/ubuntu-signature.status"
    grep -q '^\[GNUPG:\] VALIDSIG F6ECB3762474EDA9D21B7022871920D1991BC93C ' "$pg_home/ubuntu-signature.status"
    download "$ubuntu/dists/noble/main/binary-amd64/Packages.gz" "$pg_home/ubuntu-Packages.gz" 16777216
    node .github/scripts/postgres-18-packages.mjs "$pg_home/ubuntu-Release" "$pg_home/ubuntu-Packages.gz" "$pg_home/ubuntu-runtime.json" ubuntu-liburing > "$pg_home/ubuntu-runtime.tsv"
    while IFS=$'\t' read -r name filename size checksum; do
      archive="$pg_home/${filename##*/}"
      download "$ubuntu/$filename" "$archive" "$size"
      [[ "$(stat -c %s "$archive")" == "$size" ]]
      printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --strict
      [[ "$(dpkg-deb --field "$archive" Package)" == liburing2 ]]
      [[ "$(dpkg-deb --field "$archive" Version)" == 2.5-1build1 ]]
      [[ "$(dpkg-deb --field "$archive" Architecture)" == amd64 ]]
      dpkg-deb --extract "$archive" "$pg_home/root"
    done < "$pg_home/ubuntu-runtime.tsv"
  fi
  ldd "$pg_bin/postgres" > "$pg_home/postgres-after-runtime.ldd"
  if grep -q 'not found' "$pg_home/postgres-after-runtime.ldd"; then cat "$pg_home/postgres-after-runtime.ldd" >&2; exit 1; fi
  mode=PGDG_SIGNED_INDEX_AND_PINNED_DEBS
  exact_version "$pg_bin"
  printf 'LD_LIBRARY_PATH=%s\n' "$LD_LIBRARY_PATH" >> "$GITHUB_ENV"
fi
{
  printf 'Mode: %s\nFixture scope: isolated, ephemeral, no production services\n' "$mode"
  for item in "${bins[@]}"; do
    "$pg_bin/$item" --version
    sha256sum "$pg_bin/$item"
    ldd "$pg_bin/$item" > "$pg_home/$item.ldd"
    if grep -q 'not found' "$pg_home/$item.ldd"; then cat "$pg_home/$item.ldd" >&2; exit 1; fi
  done
} > "$pg_home/versions-and-runtime.txt"
printf 'RMT_PG18_BIN=%s\n' "$pg_bin" >> "$GITHUB_ENV"
cat "$pg_home/versions-and-runtime.txt"
