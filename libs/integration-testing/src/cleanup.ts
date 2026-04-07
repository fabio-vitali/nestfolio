export class CleanupRegistry {
  private readonly actions: { name: string; fn: () => Promise<void> }[] = [];

  register(name: string, fn: () => Promise<void>): void {
    this.actions.push({ name, fn });
  }

  async runAll(): Promise<void> {
    // LIFO order — most recently registered first
    const reversed = [...this.actions].reverse();
    for (const { name, fn } of reversed) {
      try {
        await fn();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`Cleanup failed: ${name}`, err);
      }
    }
  }
}
