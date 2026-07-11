/** One usage form of a command, e.g. `spawn` has both a bare form and a `--prompt` form. */
export interface CommandVariant {
  usage: string;
  summary: string;
}

/**
 * A CLI subcommand: its own argv parsing, usage text, and summary live together in one
 * file, so a rename or flag change can't drift the dispatch table out of sync with the
 * help text the way the old hand-maintained switch + free-floating help string could.
 */
export interface CliCommand {
  name: string;
  group: "sdk" | "agent";
  variants: CommandVariant[];
  run(argv: string[]): Promise<void>;
}
