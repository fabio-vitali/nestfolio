// Jest mock for @aws-appsync/utils/dynamodb. Resolver request() functions build
// DDB operations with these helpers; response() unit tests don't invoke them, so
// no-op identity stubs suffice to let the module load under ts-jest.
export const query = (args: unknown) => args;
export const get = (args: unknown) => args;
export const put = (args: unknown) => args;
export const update = (args: unknown) => args;
export const remove = (args: unknown) => args;
export const scan = (args: unknown) => args;
