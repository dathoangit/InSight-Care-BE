# Cache (Backend)

In-memory caching via NestJS `CacheModule` (`@nestjs/cache-manager`), registered globally in `app.module.ts`.

## Today bed status cache

| Key | TTL | Used by |
|-----|-----|---------|
| `beds_status_today` | 1 hour (production) | `DailyRecordService.getTodayStatus()` |

- **Production:** responses for today's bed status are cached to reduce DB load.
- **Development:** cache is skipped so seed scripts and local data changes show up immediately.

Cache is invalidated when:

- A daily record is upserted (`upsert()`)
- Today's records are locked by cron (`lockTodayRecords()`)

## Module layout

| Path | Responsibility |
|------|----------------|
| `src/constants/cache-keys.ts` | Cache key + TTL constants |
| `src/modules/daily-record/daily-record.service.ts` | Read/write cache for today status |

## Production checklist

- [ ] Be aware that today-status cache TTL is 1 hour in production
- [ ] After bulk DB changes (e.g. seed scripts), restart the API or wait for TTL expiry in production
