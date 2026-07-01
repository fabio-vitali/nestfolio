import { DdbSeedFixture } from '@nestfolio/test-support';
export const seed = () => new DdbSeedFixture('table').put({ pk: 'x' });
