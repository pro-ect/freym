import Editor from './(tabs)/editor';

/**
 * Standalone "Fine tune" route.
 *
 * Renders the full Editor screen outside the tab navigator so the "Fine tune"
 * action in the Library detail modal opens a photo in edit mode even when the
 * Edit tab is hidden. A hidden `NativeTabs.Trigger` is filtered out of the
 * navigator and is NOT navigable — pushing `/(tabs)/editor` while it's hidden
 * throws ("The focused tab in NativeTabsView cannot be displayed"). Routing
 * through this root Stack screen sidesteps tab visibility entirely.
 *
 * The Editor reads its `fineTuneUri` / `standalone` params via
 * useLocalSearchParams, which resolve to this route's params.
 */
export default function FineTuneScreen() {
  return <Editor />;
}
