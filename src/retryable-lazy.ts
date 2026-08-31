export function retryableLazy<TArg, TValue>(load: (argument: TArg) => Promise<TValue>): (argument: TArg) => Promise<TValue> {
  let pending: Promise<TValue> | undefined;
  return async (argument) => {
    pending ??= load(argument);
    try {
      return await pending;
    } catch (error) {
      pending = undefined;
      throw error;
    }
  };
}
