# WSS-through-CloudFront spike

**Status:** Completed 2026-04-24. See `docs/superpowers/specs/2026-04-24-mfe-architecture-charter.md` §9 V1 for the verification result.

This is throwaway/reference code. The CDK stack is **not deployed**. To re-run:
1. Provide `.env.local` per the plan (`docs/superpowers/plans/2026-04-24-wss-cloudfront-spike.md` Task 1).
2. `cd tools/spikes/wss-cf-spike && npx cdk deploy --require-approval never`.
3. Capture the spike CF domain into `.env.local` as `SPIKE_CF_DOMAIN`.
4. `npx ts-node src/test-client.ts`.
5. `npx cdk destroy --force` when done.

**Schema alignment note:** verify `test-client.ts` subscription + mutation still match `services/investor/investor-bff/src/schema.graphql` before re-running — AppSync rejects field-name drift with GraphQL validation errors that surface as FAIL-A in the spike.

If the AppSync API or CloudFront WS handling changes, re-run to re-verify.
