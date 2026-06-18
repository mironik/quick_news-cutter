#!/usr/bin/env bash
# Sinkroniziraj QNC v2 iz QNC_v2 → SMB share (laptop: \\HOST\quick_news_cutter\v2)
set -euo pipefail
SRC="${HOME}/QNC_v2/quick_news_cutter"
DST="${HOME}/quick_news_cutter/v2"
mkdir -p "${DST}"
rsync -a --delete \
  --exclude 'qnc-host/target' \
  --exclude '.pytest_cache' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.cursor' \
  "${SRC}/" "${DST}/"
echo "OK: ${DST}"
echo "Laptop (Windows): \\\\$(hostname -I | awk '{print $1}')\\quick_news_cutter\\v2"
echo "Ili: ~/quick_news_cutter/v2 na Jetson shareu"
