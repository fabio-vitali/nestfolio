import { App, Stack } from 'aws-cdk-lib';
import { NamingService, createNamingService } from './naming-service';

describe('NamingService', () => {
  let naming: NamingService;

  beforeEach(() => {
    naming = new NamingService({
      prefix: 'dev',
      subsystem: 'investor',
      service: 'investor-bff',
    });
  });

  it('generates correct eventBusName', () => {
    expect(naming.eventBusName()).toBe('dev-investor-event-bus');
  });

  it('generates correct tableName', () => {
    expect(naming.tableName()).toBe('dev-investor-bff-table');
  });

  it('generates correct ssmParameterPath', () => {
    expect(naming.ssmParameterPath('event-hub/busArn'))
      .toBe('/nestfolio/dev-investor/event-hub/busArn');
  });

  it('generates correct queueName without suffix', () => {
    expect(naming.queueName()).toBe('dev-investor-bff-queue');
  });

  it('generates correct queueName with suffix', () => {
    expect(naming.queueName('dlq')).toBe('dev-investor-bff-dlq-queue');
  });

  it('generates correct functionName', () => {
    expect(naming.functionName('handler')).toBe('dev-investor-bff-handler');
  });

  describe('with sandbox prefix', () => {
    beforeEach(() => {
      naming = new NamingService({
        prefix: 'sandbox-pr-42',
        subsystem: 'advisory',
        service: 'advisory-ctrl',
      });
    });

    it('generates correct eventBusName with sandbox prefix', () => {
      expect(naming.eventBusName()).toBe('sandbox-pr-42-advisory-event-bus');
    });

    it('generates correct tableName with sandbox prefix', () => {
      expect(naming.tableName()).toBe('sandbox-pr-42-advisory-ctrl-table');
    });

    it('generates correct ssmParameterPath with sandbox prefix', () => {
      expect(naming.ssmParameterPath('config/apiUrl'))
        .toBe('/nestfolio/sandbox-pr-42-advisory/config/apiUrl');
    });
  });
});

describe('createNamingService', () => {
  it('reads prefix from CDK context', () => {
    const app = new App({ context: { prefix: 'staging' } });
    const stack = new Stack(app, 'TestStack');
    const naming = createNamingService(stack, {
      subsystem: 'execution',
      service: 'execution-ctrl',
    });

    expect(naming.eventBusName()).toBe('staging-execution-event-bus');
    expect(naming.tableName()).toBe('staging-execution-ctrl-table');
  });

  it('throws when prefix is not in context', () => {
    const app = new App();
    const stack = new Stack(app, 'TestStack');
    expect(() =>
      createNamingService(stack, {
        subsystem: 'investor',
        service: 'investor-hub',
      }),
    ).toThrow('CDK context "prefix" is required');
  });
});
