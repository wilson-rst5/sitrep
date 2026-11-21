# Architecture

Compose runs a web reverse proxy, stateless API, collector, storage consumer, PostGIS database, JetStream broker and an Alembic migration job. API, collector and consumer share a Python image and have independent process entry points. Provider normalisation happens in the collector.

The collector holds a database advisory lock per provider and records attempts before fetching. It validates bounded responses from fixed HTTPS endpoints and publishes versioned events. The durable consumer validates each message again and only acknowledges after the transaction commits. A composite provider ID and external ID prevents duplicate storage. Failed writes trigger delayed redelivery. Invalid payloads produce a redacted record on a rejection subject.

The browser receives authenticated revision signals and re-fetches filtered data. Polling continues as a fallback. Spatial searches use PostGIS geography. Official district warnings use an explicit provider district match and do not have synthetic points.

An installation can scale API and storage consumers independently. Before placing services on multiple hosts, provision authenticated external database and broker instances, a TLS ingress and a migration job. The first schema has fixed per-event expiration. Additional telemetry tables, scoped provider configuration, alerting and intelligence remain planned.
