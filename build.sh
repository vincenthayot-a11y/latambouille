#!/bin/sh
set -e
cd "$(dirname "$0")"
python3 transform.py
./node_modules/.bin/esbuild src/app.jsx --bundle --minify --jsx=automatic --format=iife --define:process.env.NODE_ENV='"production"' --outfile=app.js
