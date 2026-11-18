#!/usr/bin/env bash
set -euo pipefail

# The regional HTTP mirror previously exhausted a browser job's time limit.
# Change only Ubuntu's download URI; retain suites, components and signing keys.
sources=/etc/apt/sources.list.d/ubuntu.sources
grep -q '^Signed-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg' "$sources"
sudo sed -E -i 's|^URIs:.*|URIs: https://archive.ubuntu.com/ubuntu|g' "$sources"
echo 'Acquire::Retries "2"; Acquire::http::Timeout "30"; Acquire::https::Timeout "30";' \
  | sudo tee /etc/apt/apt.conf.d/80rmt-ci-network > /dev/null
