/// <reference types="jest" />
import { installDnsResilience } from '@nestfolio/test-support';

// Retry transient getaddrinfo (ENOTFOUND / EAI_AGAIN) at the DNS layer so a
// high-parallelism `nx run-many -t test-integration` sweep does not false-red
// when the macOS resolver is briefly overwhelmed. Covers every AWS access path
// in the harness (SDK clients + AppSync fetch). See backlog
// `test-integration-parallel-dns-exhaustion`.
installDnsResilience();

jest.retryTimes(1, { logErrorsBeforeRetry: true });
