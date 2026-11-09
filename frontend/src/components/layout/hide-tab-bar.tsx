/** Rendered by screens that own the bottom edge (booking bar, checkout): hides the phone tab bar with no JS and no flash. */
export function HideTabBar() {
  return <style>{`.tabbar{display:none!important}`}</style>;
}
