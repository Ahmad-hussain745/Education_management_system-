// Every /portal/* page resolves the selected child the same way: the
// ?child= query param if it names one of THIS parent's own linked
// children, else their first child. This never widens what a parent can
// see — RLS (0030_parent_portal.sql's "parent reads own children" and
// everything built on is_parent_of()) is what actually enforces "own
// children only" no matter what id ends up in the URL. `kids` here is
// always roleContext.children, which is itself already scoped to the
// signed-in parent by RLS before this function ever runs.
export function resolveSelectedChild(searchParams, kids) {
  if (!kids || kids.length === 0) return null;
  const requested = searchParams?.child;
  return kids.find((k) => k.id === requested) || kids[0];
}
