import { EventFixture } from '@nestfolio/test-support';
export const seed = () => new EventFixture().emit('DepositInitiated', { amount: 100 });
