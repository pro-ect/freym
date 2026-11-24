/** Exit codes: 1 usage or a plan that does not pass the checks, 2 not found, 3 network or IO, 4 sign-in. */
export class CliError extends Error {
  constructor(
    message: string,
    public code = 1,
    public details?: unknown,
  ) {
    super(message);
  }
}
