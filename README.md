<!-- AUTO-GENERATED README — DO NOT EDIT. Changes will be overwritten on next publish. -->
# claude-code-plugin-aftership

Dedicated agent for AfterShip shipment tracking operations

![Version](https://img.shields.io/badge/version-1.1.6-blue) ![License: MIT](https://img.shields.io/badge/License-MIT-green) ![Node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

## Features

- Tracking
- **list-trackings** — List trackings with filters
- **get-tracking** — Get full tracking details
- **search-by-order** — Find tracking by Shopify order #
- **create-tracking** — Create a new tracking
- **update-tracking** — Update tracking metadata
- **delete-tracking** — Delete a tracking
- **retrack** — Retrack an expired tracking
- **mark-completed** — Mark tracking as completed
- Monitoring
- **find-exceptions** — List trackings with issues
- **find-delayed** — Find overdue shipments
- **active-shipments** — List all non-delivered trackings
- **recent-deliveries** — List recently delivered
- Courier
- **list-couriers** — List available couriers
- **detect-courier** — Detect courier from tracking number
- Utility
- **api-status** — Check API key validity, rate limits
- **resolve-tracking** — Smart detection with carrier fallback
- **list-tools** — List all available CLI commands
- Cache
- **cache-stats** — Show cache statistics
- **cache-clear** — Clear all cached data
- **cache-invalidate** — Invalidate specific cache key

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI
- API credentials for the target service (see Configuration)

## Quick Start

```bash
git clone https://github.com/YOUR_GITHUB_USER/claude-code-plugin-aftership.git
cd claude-code-plugin-aftership
cp config.template.json config.json  # fill in your credentials
cd scripts && npm install
```

```bash
node scripts/dist/cli.js list-trackings
```

## Installation

1. Clone this repository
2. Copy `config.template.json` to `config.json` and fill in your credentials
3. Install dependencies:
   ```bash
   cd scripts && npm install
   ```

## Available Commands

### Tracking Commands

| Command           | Description                      | Options                                                                              |
| ----------------- | -------------------------------- | ------------------------------------------------------------------------------------ |
| `list-trackings`  | List trackings with filters      | `--status`, `--slug`, `--order-id`, `--created-after`, `--created-before`, `--limit` |
| `get-tracking`    | Get full tracking details        | `--id` OR `--tracking-number` + `--slug`                                             |
| `search-by-order` | Find tracking by Shopify order # | `--order` (required)                                                                 |
| `create-tracking` | Create a new tracking            | `--tracking-number`, `--slug`, `--order-id`, `--title`, `--custom-fields` (JSON)     |
| `update-tracking` | Update tracking metadata         | `--id`, `--title`, `--order-id`                                                      |
| `delete-tracking` | Delete a tracking                | `--id` (required)                                                                    |
| `retrack`         | Retrack an expired tracking      | `--id` (required)                                                                    |
| `mark-completed`  | Mark tracking as completed       | `--id`, `--reason` (DELIVERED/LOST/RETURNED_TO_SENDER)                               |

### Monitoring Commands

| Command             | Description                      | Options                                |
| ------------------- | -------------------------------- | -------------------------------------- |
| `find-exceptions`   | List trackings with issues       | `--limit`, `--days` (lookback period)  |
| `find-delayed`      | Find overdue shipments           | `--days` (threshold varies by carrier) |
| `active-shipments`  | List all non-delivered trackings | `--limit`, `--slug`                    |
| `recent-deliveries` | List recently delivered          | `--limit`, `--days`                    |

### Courier Commands

| Command          | Description                         | Options                                   |
| ---------------- | ----------------------------------- | ----------------------------------------- |
| `list-couriers`  | List available couriers             | `--all` (include all, not just connected) |
| `detect-courier` | Detect courier from tracking number | `--tracking-number` (required)            |

### Utility Commands

| Command            | Description                           | Options             |
| ------------------ | ------------------------------------- | ------------------- |
| `api-status`       | Check API key validity, rate limits   |                     |
| `resolve-tracking` | Smart detection with carrier fallback | `--tracking-number` |
| `list-tools`       | List all available CLI commands       |                     |

### Cache Commands

| Command            | Description                   | Options                 |
| ------------------ | ----------------------------- | ----------------------- |
| `cache-stats`      | Show cache statistics         |                         |
| `cache-clear`      | Clear all cached data         |                         |
| `cache-invalidate` | Invalidate specific cache key | `--key` OR `--order-id` |

### Global Options

| Option       | Description                   |
| ------------ | ----------------------------- |
| `--no-cache` | Bypass cache for this request |
| `--help`     | Show help message             |

## Usage Examples

```bash
# Search by Shopify order number (most common)
node scripts/dist/cli.js search-by-order --order 12345

# List all in-transit shipments
node scripts/dist/cli.js list-trackings --status InTransit --limit 20

# Find problem shipments
node scripts/dist/cli.js find-exceptions --days 7

# Find delayed deliveries (carrier-aware thresholds)
node scripts/dist/cli.js find-delayed

# Get tracking details by ID
node scripts/dist/cli.js get-tracking --id abc123xyz

# Retrack an expired shipment
node scripts/dist/cli.js retrack --id abc123xyz

# Smart tracking number lookup with carrier fallback
node scripts/dist/cli.js resolve-tracking --tracking-number 1Z999AA10123456784

# Create tracking with custom fields (for inbound tracking automation)
node scripts/dist/cli.js create-tracking --tracking-number 1Z999AA10123456784 --slug ups --custom-fields '{"direction":"inbound","vendor":"Acme Corp"}'
```

## How It Works

This plugin connects directly to the service's HTTP API. The CLI handles authentication, request formatting, pagination, and error handling, returning structured JSON responses.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Authentication errors | Verify credentials in `config.json` |
| `ERR_MODULE_NOT_FOUND` | Run `cd scripts && npm install` |
| Rate limiting | The CLI handles retries automatically; wait and retry if persistent |
| Unexpected JSON output | Check API credentials haven't expired |

## Contributing

Issues and pull requests are welcome.

## License

MIT
