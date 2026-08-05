type Cleanup = () => void;

export const createAsyncLifecycle = (): {
  load: ({
    initialize,
  }: {
    initialize: (isCancelled: () => boolean) => Promise<Cleanup>;
  }) => Promise<boolean>;
  unload: () => void;
} => {
  let activeCleanup: Cleanup | null = null;
  let generation = 0;

  const load = async ({
    initialize,
  }: {
    initialize: (isCancelled: () => boolean) => Promise<Cleanup>;
  }): Promise<boolean> => {
    const loadGeneration = ++generation;
    const isCancelled = (): boolean => loadGeneration !== generation;

    let nextCleanup: Cleanup;
    try {
      nextCleanup = await initialize(isCancelled);
    } catch (error) {
      if (isCancelled()) return false;
      throw error;
    }

    if (isCancelled()) {
      nextCleanup();
      return false;
    }

    activeCleanup?.();
    activeCleanup = nextCleanup;
    return true;
  };

  const unload = (): void => {
    generation += 1;
    activeCleanup?.();
    activeCleanup = null;
  };

  return { load, unload };
};
