# Popular Movies Historic

[![CI](https://github.com/jskrd/popular-movies-historic/actions/workflows/ci.yml/badge.svg)](https://github.com/jskrd/popular-movies-historic/actions/workflows/ci.yml)

## About

Popular Movies Historic is an archive of popular movies from December 2019 to today. This service collects and stores daily snapshots from [Steven Lu's
Popular Movies project](https://github.com/sjlu/popular-movies), creating a single place to access popular movies over time.

The service is built for integration with [Radarr](https://radarr.video/).

## Tech Stack

- ☁️ **Cloudflare Workers** - Serverless compute platform
- 🪣 **Cloudflare R2** - Object storage for movie data
- 🔷 **TypeScript** - Type-safe JavaScript
- ✅ **Zod** - Schema validation and parsing
- 🧪 **Vitest** - Unit testing framework
- 🧹 **Biome** - Code formatting and linting
- 📦 **pnpm** - Disk space efficient package manager
