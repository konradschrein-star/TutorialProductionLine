import {
  listClipLibraries as repoListClipLibraries,
  getClipLibraryById,
  listReferenceScripts as repoListReferenceScripts,
} from "@repo/db/repositories";
import { CfApiError } from "../errors.js";
import type { CfRuntime } from "../runtime.js";

export async function listClipLibraries(_rt: CfRuntime) {
  return repoListClipLibraries();
}

export async function getClipLibrary(_rt: CfRuntime, id: string) {
  const lib = await getClipLibraryById(id);
  if (!lib) throw new CfApiError("NOT_FOUND", `Clip library ${id} not found`);
  return lib;
}

export async function listReferenceScripts(_rt: CfRuntime, libraryId: string) {
  return repoListReferenceScripts(libraryId);
}
