---
name: No DDB seeding in integration tests
description: Integration test fixtures must populate state via events or mutations, never DdbSeedFixture or direct DDB writes
type: feedback
---
Integration test fixtures must NEVER write directly to service DDB tables. Populate state through the application's own pipelines: EventBridge events or AppSync mutations. (In-repo ring-2 mirror.)
