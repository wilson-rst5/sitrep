# Provider development

Register a new adapter explicitly in `services/core/sitrep/providers.py`. The existing `Provider` contract records identity, source URL, category, documentation, terms, coverage and poll interval. Implement a normaliser that accepts parsed JSON and fetch time and yields validated `Event` instances.

Use a fixed documented HTTPS origin and preserve an attributable source URL. Keep missing coordinates as null. IDs must remain stable across repeated fetches. Store timestamps in UTC, and set an expiration that reflects the feed. Reserve the critical level for official warnings. Add tests for malformed responses, duplicate IDs, attribution and field boundaries.

The collector disables redirects, bounds the response size, records health, and backs off after errors. Adapters that require secrets, XML, paging or authenticated local receivers need explicit implementation and review.
