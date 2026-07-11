/** One usage form of a command, e.g. `spawn` has both a bare form and a `--prompt` form. */
export interface CommandVariant {
  usage: string;
  summary: string;
}

/**
 * A CLI subcommand's own argv parsing plus its own copy of usage text/summary,
 * checked against `commands/registry.ts`'s duplicate entry when adding a command.
 * Dispatch and generated help text are driven entirely from the `commands` list
 * in `registry.ts`, not from this file's own `variants`.
 */
export interface CliCommand {
  name: string;
  group: "sdk" | "agent";
  variants: CommandVariant[];
  run(argv: string[]): Promise<void>;
}
