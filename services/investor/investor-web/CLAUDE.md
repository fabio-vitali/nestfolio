# investor-web

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-web/src/service.stack.ts

## State
None (stateProps: false)

## Infrastructure
- Cognito UserPool: investor authentication (email sign-in, MFA optional, custom tenant_id attribute)
- S3 AssetsBucket: static web assets (encrypted, no public access)
- CloudFront Distribution: SPA hosting with security headers (CSP, HSTS, X-Frame-Options DENY)
  - Error responses: 404 → /index.html (SPA routing)

## Cognito Triggers (direct Lambda, not via Ingress)
- PostConfirmation → handlers/post-confirmation.ts (emits USER_REGISTERED to EventBridge)
- PostAuthentication → handlers/post-authentication.ts (emits USER_AUTHENTICATED to EventBridge)

## SSM Parameters Published
- auth/userPoolId
- auth/userPoolClientId
- web/distributionUrl

## Handlers
- post-confirmation.ts
- post-authentication.ts

## Tests
- handlers/post-authentication.test.ts
- handlers/post-confirmation.test.ts
- service.stack.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils
