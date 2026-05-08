/**
 * Barrel export for the general-assistant tool modules.
 * Each module follows the standard `definitions` + `executors` shape so the
 * top-level tool registry (../index.ts) can fold them into the global maps.
 */

export * as web from "./web";
export * as knowledge from "./knowledge";
export * as email from "./email";
export * as database from "./database";
