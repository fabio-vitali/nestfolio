# investor-web

Domain: investor | Bus: InvestorBus
Stack: services/investor/investor-web/src/service.stack.ts

## State
None (frontend hosting + auth infrastructure)

## Infrastructure
- Cognito UserPool: investor authentication
  - Email sign-in, auto-verify email
  - MFA optional, password policy (8+ chars, upper/lower/digits)
  - Custom attribute: tenant_id (immutable)
  - AccountRecovery: email only
  - RemovalPolicy: RETAIN in prod, DESTROY otherwise
- Cognito WebClient: userPassword + userSrp auth flows, no secret
- S3 AssetsBucket: static web assets (S3-managed encryption, block all public access)
- CloudFront Distribution: SPA hosting
  - HTTPS redirect, OAI for S3 access
  - Security headers: CSP, X-Frame-Options DENY, HSTS, X-Content-Type-Options, Referrer-Policy
  - Error responses: 404 → /index.html (SPA routing)

## Cognito Triggers (direct Lambda, not via Ingress)
- PostConfirmation → post-confirmation.ts
  - Generates tenantId (UUID), sets custom:tenant_id attribute
  - Emits USER_REGISTERED to InvestorBus via direct PutEvents
- PostAuthentication → post-authentication.ts
  - Emits USER_AUTHENTICATED to InvestorBus via direct PutEvents (only if tenant_id exists)

## SSM Parameters Published
- auth/userPoolId
- auth/userPoolClientId
- auth/region
- web/distributionUrl
- web/distributionId

## Handlers
- post-confirmation.ts — Cognito PostConfirmation trigger, emits USER_REGISTERED
- post-authentication.ts — Cognito PostAuthentication trigger, emits USER_AUTHENTICATED

## Tests
- handlers/post-authentication.test.ts
- handlers/post-confirmation.test.ts

## Dependencies
- libs: cdk-constructs/core, cdk-constructs/utils, event-processor
- AWS SDKs: @aws-sdk/client-eventbridge, @aws-sdk/client-cognito-identity-provider
