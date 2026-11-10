/**
 * The version of the SDK's public API: the package's major version. A host
 * reads it to check that the bundle it loaded is the API it was written against.
 *
 * The rule: a release that breaks the public API (an export removed or renamed, a signature or
 * option changed incompatibly, an event's shape or a command outcome changed) raises the major
 * version, and this with it; additions and fixes do not. Until the API freeze the package is
 * 0.x and this is 0: under 0.x a minor release may break, so a host pins the minor version, and
 * the changelog (Changesets) names every breaking change. From 1.0.0 it is the major version,
 * and a host that finds a different one than it expects knows the calls it makes may differ.
 */
export const SDK_API_VERSION = 0;
